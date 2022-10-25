const path = require('path');
const net = require('net');
const { createHash } = require('crypto');
const { Writable } = require('stream');
const { createReadStream } = require('fs');
const { exists, mkdir, rename, open, readdir, stat } = require('fs/promises');
const EventEmitter = require('events');
const splitStream = require('../../src/split-stream');

// Step 0: create helpers for everything

const hashFile = (filepath) =>
  new Promise((resolve) => {
    createReadStream(filepath)
      .pipe(createHash('sha256'))
      .setEncoding('hex')
      .pipe(
        new Writable({
          write(chunk, enc, next) {
            resolve(chunk.toString());
          },
        })
      );
  });

// Another helper to format file size with a right suffix
const formatSize = (size) => {
  const suffixes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let suffixIndex = 0;

  while (size >= 1024) {
    size = size / 1024;
    suffixIndex++;
  }

  return `${size.toFixed(2)}${suffixes[suffixIndex]}`;
};

// Step 1: Index files that we'll make available for download
const index = new Map();

async function* findFiles(folder) {
  for (let filename of await readdir(folder)) {
    const filepath = path.resolve(folder, filename);
    const fileStats = await stat(filepath);

    if (fileStats.isDirectory()) {
      yield* findFiles(filepath);
    } else {
      yield { path: filepath, size: fileStats.size };
    }
  }
}

const indexFiles = async () => {
  console.log('🌱 Indexing files...');

  for await (let { path, size } of findFiles(process.cwd())) {
    const [name] = path.split('/').slice(-1);
    const hash = await hashFile(path);

    index.set(hash, { hash, size, name, path });
  }

  console.log(`🌳 Directory content indexed, ${index.size} files found.`);
};

indexFiles();

setInterval(() => indexFiles(), 60000);

// Step 2: create P2P node with swenssonp2p and run it on the port
// provided inside argv. I don't know exactly what I will be doing
// once it's up, so I leave a socket there
const main = new EventEmitter();
const createNode = require('swenssonp2p');

const node = createNode();
const port = Number(process.argv[2]);

setTimeout(() => node.listen(port, () => main.emit('startup', port)), 0);

// Step 2.5: add rebalancing to the nodes (ask for neighbors and connect to them randomly)
// every 10 seconds we ask for neighbors' neighbors and connect to them until we have 5 connections
const NEIGHBORS_COUNT_TARGET = 5;
let ip = '127.0.0.1';

require('https').get('https://api.ipify.org?format=text', (responseStream) => {
  let data = '';
  responseStream
    .on('data', (chunk) => (data += chunk))
    .on('end', () => {
      ip = data;
    });
});

const getNeighbors = (id) =>
  new Promise((resolve) => {
    const listener = ({ origin, message: { type, meta } }) => {
      if (type === 'balance/response' && id === origin) {
        resolve(meta);
        node.off('direct', listener);
      }
    };

    node.on('direct', listener);
    node.direct(id, { type: 'balance', meta: {} });
  });

const getIp = (id) =>
  new Promise((resolve) => {
    const listener = ({ origin, message: { type, meta } }) => {
      if (type === 'ip/response' && id === origin) {
        resolve(meta);
        node.off('direct', listener);
      }
    };

    node.on('direct', listener);
    node.direct(id, { type: 'ip', meta: {} });
  });

node.on('direct', ({ origin, message: { type } }) => {
  if (type === 'ip') {
    node.direct(origin, { type: 'ip/response', meta: { ip, port } });
  }
});

node.on('direct', ({ origin, message: { type } }) => {
  if (type === 'balance') {
    const neighbors = Array.from(node.neighbors());

    node.direct(origin, { type: 'balance/response', meta: neighbors });
  }
});

main.on('startup', () => {
  setInterval(async () => {
    const neighbors = Array.from(node.neighbors());
    const neighborsOfNeighborsGroups = await Promise.all(
      neighbors.map((id) => getNeighbors(id))
    );
    const neighborsOfNeighbors = neighborsOfNeighborsGroups.reduce(
      (acc, group) => acc.concat(group),
      []
    );
    const potentialConnections = neighborsOfNeighbors.filter(
      (id) => id !== node.id && !neighbors.includes(id)
    );
    const addressesToConnect = await Promise.all(
      potentialConnections.map((id) => getIp(id))
    );

    for (let { ip, port } of addressesToConnect.slice(
      0,
      NEIGHBORS_COUNT_TARGET - neighbors.length
    )) {
      node.connect(ip, port, () => {
        console.log(
          `🕷️ Connection to ${ip} established (network random rebalance).`
        );
      });
    }
  }, 30000);
});

// Step 3: Let the user know what they can do in a generic manner
// Since there are more commands for this app than chat - I guess
// it makes sense to let every command' implementation have their
// own listener to `help` event
main.on('startup', (port) => {
  console.log(`🕸️  Node is up on ${port}.`);

  main.emit('help');

  process.stdin.on('data', (data) => main.emit('command', data.toString()));
});

// Step 4: Start implementing commands. The first command I will use
// is the connect command - it works exactly the same way as in chat
main.on('help', () => {
  console.log(
    '    - write "connect IP:PORT" to connect to other nodes on network.'
  );
});

main.on('command', (text) => {
  if (text.startsWith('connect')) {
    const ipPort = text.substr(8);
    const [ip, port] = ipPort.split(':');

    console.log(`🕷️ Connecting to ${ip} at ${Number(port)}...`);
    node.connect(ip, Number(port), () => {
      console.log(`🕷️ Connection to ${ip} established.`);
    });
  }
});

// Step 5: now I want to be able to lookup for files by their names
// to do this, I create `search` command
main.on('help', () => {
  console.log('    - write "search FILENAME" to look for files.');
});

main.on('command', (text) => {
  if (text.startsWith('search')) {
    const searchRequest = text.substr(7).trim();

    console.log(`🔎 Searching for file by "${searchRequest}"...`);
    node.broadcast({ type: 'search', meta: searchRequest });
  }
});

node.on('broadcast', ({ origin, message: { type, meta } }) => {
  if (type === 'search' && origin !== node.id) {
    for (let key of index.keys()) {
      const data = index.get(key);

      if (data.name.toLowerCase().includes(meta.toLowerCase())) {
        node.direct(origin, { type: 'search/response', meta: data });
      }
    }
  }
});

node.on('direct', ({ origin, message: { type, meta } }) => {
  if (type === 'search/response') {
    const { name, size, hash } = meta;

    console.log(`  ${name} ${formatSize(size)} ${hash}`);
  }
});

// Step 6: now I want to start download, let's introduce this command
// after we performed search we know hash, so we can use that to kick
// off the downloading process
main.on('help', () => {
  console.log('    - write "download HASH" to start downloading file');
});

main.on('command', (text) => {
  if (text.startsWith('download')) {
    main.emit('download', text.substr(9).trim());
  }
});

// In order to download something we should have its meta information
// e.g. chunks and their state, filename and so on. Once the meta is
// filled, I emit download/ready
const downloads = {};

main.on('download', (hash) => {
  console.log(`🔎 Looking for "${hash}" metadata...`);
  node.broadcast({ type: 'download', meta: hash });
});

node.on('broadcast', ({ origin, message: { type, meta } }) => {
  if (type === 'download' && origin !== node.id) {
    const data = index.get(meta);

    if (!!data) {
      node.direct(origin, {
        type: 'download/response',
        meta: { ip: ip, hash: data.hash, size: data.size, name: data.name },
      });
    }
  }
});

node.on('direct', ({ origin, message: { type, meta } }) => {
  if (type === 'download/response') {
    if (!downloads[meta.hash]) {
      downloads[meta.hash] = {
        hash: meta.hash,
        name: meta.name,
        size: meta.size,
        seeds: [meta.ip],
        chunks: [],
      };

      main.emit('download/ready', meta.hash);
    } else {
      downloads[meta.hash].seeds.push(meta.ip);
      main.emit('download/update', meta.hash);
    }
  }
});

// Step 7: now I setup the TCP server to accept file downloading connections
// and send chunks of data, no safety implemented
const FILES_SERVER_PORT = 30163;
const CHUNK_SIZE = 512;

const filesServer = net
  .createServer((socket) => {
    socket.pipe(splitStream()).on('data', async ({ hash, offset }) => {
      const data = index.get(hash);

      const chunk = Buffer.alloc(CHUNK_SIZE);
      const file = await open(data.path, 'r');

      await file.read(chunk, 0, CHUNK_SIZE, offset * CHUNK_SIZE);
      await file.close();

      socket.write(JSON.stringify({ hash, offset, chunk }));
    });
  })
  .listen(FILES_SERVER_PORT);

const downloadChunk = (socket, hash, offset) =>
  new Promise((resolve) => {
    const socketSplitStream = socket.pipe(splitStream());

    socket.write(JSON.stringify({ hash, offset }));

    const listener = (message) => {
      if (hash === message.hash && offset === message.offset) {
        socketSplitStream.off('data', listener);
        resolve(message.chunk);
      }
    };

    socketSplitStream.on('data', listener);
  });

// Step 8: actual downloading process, we create an async loop
// and process every download until it's finished and remove it
// after
const DOWNLOADS_PATH = path.resolve(process.cwd(), '.downloads');

(async () => {
  if (!(await stat(DOWNLOADS_PATH).catch(() => null))) {
    await mkdir(DOWNLOADS_PATH, 0744);
  }
})();

main.on('download/ready', async (hash) => {
  console.log('Downloading', hash);
  downloads[hash].path = path.resolve(DOWNLOADS_PATH, `${hash}.download`);
  downloads[hash].chunks = [
    ...new Array(Math.ceil(downloads[hash].size / CHUNK_SIZE)),
  ].map(() => ({ state: 0 }));

  const file = await open(downloads[hash].path, 'w');

  // Connections establishment

  const sockets = {};

  const updateSocketsList = async ($hash) => {
    if ($hash === hash) {
      for (let ip of downloads[hash].seeds) {
        if (!sockets[ip]) {
          const socket = new net.Socket();

          socket.connect(FILES_SERVER_PORT, ip, () => {
            sockets[ip] = { socket, busy: false };
          });
        }
      }
    }
  };

  updateSocketsList(hash);

  main.on('download/update', updateSocketsList);

  // Main loop

  while (!!downloads[hash].chunks.find((chunk) => chunk.state !== 2)) {
    const availableChunkIndex = downloads[hash].chunks.findIndex(
      (chunk) => chunk.state === 0
    );
    const availableSocket = Object.values(sockets).find(({ busy }) => !busy);

    if (!availableSocket || availableChunkIndex === -1) {
      await new Promise((resolve) => setTimeout(() => resolve(), 50));
      continue;
    }

    availableSocket.busy = true;
    downloads[hash].chunks[availableChunkIndex].state = 1;

    (async () => {
      const chunk = await downloadChunk(
        availableSocket.socket,
        hash,
        availableChunkIndex
      );

      await file.write(
        Buffer.from(chunk),
        0,
        CHUNK_SIZE,
        availableChunkIndex * CHUNK_SIZE
      );

      downloads[hash].chunks[availableChunkIndex].state = 2;
      availableSocket.busy = false;
    })();
  }

  // Cleanup

  await file.close();
  await rename(
    downloads[hash].path,
    path.resolve(DOWNLOADS_PATH, downloads[hash].name)
  );

  main.off('download/update', updateSocketsList);

  for (let { socket } of Object.values(sockets)) {
    socket.destroy();
  }

  console.log('Download completed', hash);
});
