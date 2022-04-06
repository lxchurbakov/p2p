//
// Minimal Torrent application using swenssonp2p library
// uses p2p network to exchange files information and
// creates TCP connection to peers to download data
//
const net = require('net');
const path = require('path');
const EventEmitter = require('events');

const { splitjson, delay, findFiles, hashFile, formatSize } = require('./utils');

// Instance of files index to keep all the information
// about them in one place
const index = new Map();

// A main method to fill the index with data,
// accepts the filepath, grabs the hashsum and
// puts the data to the index
const indexFile = async (path, size) => {
  const [name] = path.split('/').slice(-1);
  const hash = await hashFile(path);

  index.set(hash, { hash, size, name, path });
};

// First of all, let's kick off the indexing process
// We don't want that to pause the main flow, so we kick
// it off in a separate function
;(async () => {
  console.log('Start indexing files...');

  for await (let { path, size } of findFiles(process.cwd())) {
    indexFile(path, size);
  }

  console.log(`Directory content indexed, ${index.size} files found`);
})();

// Now, let's create a node and emit event.
// We delay the listen to let all the subscribes happen
const mainee = new EventEmitter();
const createNode = require('../../src');

const node = createNode();
const port = Number(process.argv[2]);

setTimeout(() => {
  node.listen(port, () => {
    mainee.emit('startup', port);
  });
}, 0);

// After the node is up, we need to provide user
// with instructions, let's do it. Each instruction
// is going to be listed below this piece of code as
// separate "plugin"
mainee.on('startup', (port) => {
  console.log(`P2P node is up on ${port}.`);
  console.log('');

  mainee.emit('help');

  process.stdin.on('data', (data) => {
    mainee.emit('command', data.toString());
  });
});

// First of all, let's implement a command
// of connection to other nodes
mainee.on('help', () => {
  console.log('Write "connect IP:PORT" to connect to other nodes on the network.');
});

mainee.on('command', (text) => {
  if (text.startsWith('connect')) {
    const [,ipport] = text.split(' ');
    const [ip, port] = ipport.split(':');

    console.log(`Connecting to ${ip} at ${Number(port)}...`);
    node.connect(ip, Number(port), () => {
      console.log(`Connection to ${ip} established.`);
    });
  }
});

// Secondly, we want to look for some file on the network
// by its name - we broadcast search message and collect
// responses with magnet links, which we'll use later to
// actually kick off file download
mainee.on('help', () => {
  console.log('Write "search FILENAME" to look for the files.');
});

mainee.on('command', (text) => {
  if (text.startsWith('search')) {
    const searchRequest = text.substr(7).trim();

    console.log(`Searching for file named "${searchRequest}"`);
    node.broadcast({ type: 'search', meta: searchRequest });
  }
});

// Respond to search request from other nodes
node.on('broadcast', ({ origin, message: { type, meta }}) => {
  if (type === 'search' && origin !== node.id) {
    const searchRequest = meta;

    for (let key of index.keys()) {
      const data = index.get(key);

      if (data.name.toLowerCase().includes(searchRequest.toLowerCase())) {
        node.direct(origin, { type: 'search/response', meta: index.get(key) });
      }
    }
  }
});

// And eventually, when search results arrive, we post them to console
// we don't save it anywhere as it's only related to search, by knowing
// hash you can look up directly
node.on('direct', ({ origin, message: { type, meta: { name, size, hash } }}) => {
  if (type === 'search/response') {
    console.log(`  ${name} ${formatSize(size)} ${hash}`);
  }
});

// After we have performed search, we may need to download the file
// in order to do so, we have to obtain filehash, look it up on the
// network in order to find all the users that may have it, connect
// to them via tcp and start requesting chunks. To do this stuff, I
// need to create a "download manager", that will hold the space on
// the disk, write chunks to them and notify other parts of the app
// when the download is finished

// First of all we need to create a state, where the information about
// downloads will be stored. Using our p2p connection we will fill the
// state and later, using TCP connection, we will download the files.
const downloads = {};

// Introduce download by hash command, add reaction to this command
// - broadcasting download message, pretty same process, as we have
// for the search command
mainee.on('help', () => console.log('Write download HASH to start downloading file'));

mainee.on('command', (text) => {
  if (text.startsWith('download')) {
    const hash = text.substr(9).trim();

    downloads[hash] = {
      hash,
      name: '',
      size: 0,
      seeds: [],
      chunks: [],
    }

    node.broadcast({ type: 'download', meta: hash });
    mainee.emit('download', hash);
  }
});

node.on('broadcast', ({ origin, message: { type, meta } }) => {
  if (type === 'download' && origin !== node.id) {
    const data = index.get(meta);

    if (!!data) {
      node.direct(origin, { type: 'download/response', meta: { ip: Array.from(node.addresses)[0], hash: data.hash, size: data.size, name: data.name } })
    }
  }
});

node.on('direct', ({ origin, message: { type, meta } }) => {
  if (type === 'download/response') {
    downloads[meta.hash].name = meta.name;
    downloads[meta.hash].size = meta.size;
    downloads[meta.hash].seeds.push(meta.ip);
  }
});

// Now we have the state filled with data, we need to setup a TCP
// server to accept download_chunk requests from other nodes
const FILES_SERVER_PORT = 9019;


if (port === 8001) {

const filesServer = net.createServer((socket) => {
  // Handle data coming from a peer (basically chunks requests)
  socket.on('data', (data) => {
    // console.log('Files server received data', data.toString());
    for (let { hash, index } of splitjson(data)) {
      // We want to put all heavy load (working with files)
      // separately, so use this approach
      mainee.emit('chunk', { hash, index, socket });
    }
  });
}).listen(FILES_SERVER_PORT);

}

// A wrapper function to actually download chunk from socket
const downloadChunk = (socket, hash, index) => new Promise((resolve) => {
  socket.write(JSON.stringify({ hash, index }));

  const listener = (data) => {
    for (let message of splitjson(data)) {
      if (hash === message.hash && index === message.index) {
        resolve(message.chunk);
        socket.off('data', listener);
      }
    }
  };

  socket.on('data', listener);
});

// Alright, now we're ready to go. In this piece of code we will concentrate
// the artillery - kick off download, handle chunks requests and - send them
// First of all, let's create a stub file for when download has started
const { writeFile, stat, open, exists, mkdir, rename } = require('fs/promises');

const CHUNK_SIZE = 1024; // 1 KB
const DOWNLOADS_PATH = path.resolve(process.cwd(), '.downloads');

// Create a download directory if it does not exist
;(async () => {
  if (!await stat(DOWNLOADS_PATH).catch(() => null)) {
    await mkdir(DOWNLOADS_PATH, 0744);
  }
})();

mainee.on('download', async (hash) => {
  // First of all we await for seeds to join as there may be none
  while (downloads[hash].seeds.length === 0) {
    await delay(100);
  }

  // Once seeds arrive, we should fill the chunks structure and
  // create the file we will write data to
  downloads[hash].path = path.resolve(DOWNLOADS_PATH, `${hash}.download`);
  downloads[hash].chunks = [...new Array(Math.ceil(downloads[hash].size / CHUNK_SIZE))].map(() => ({ state: 0 }));

  const file = await open(downloads[hash].path, 'w');

  // In addition to that, we should keep all the sockets
  // that we are downloading data from in a separate map
  // That should happen "in parallel" with the main flow
  let sockets = {};

  const updateSockets = async () => {
    if (!downloads[hash]) {
      return;
    }

    for (let ip of downloads[hash].seeds) {
      if (!sockets[ip]) {
        const socket = new net.Socket();
        socket.connect(FILES_SERVER_PORT, ip, () => {
          // console.log('new connection to seed', FILES_SERVER_PORT, ip);
          sockets[ip] = { socket: socket, busy: false };
        });
      }
    }

    setTimeout(updateSockets, 500);
  };

  updateSockets();

  // In a loop we request chunks from sockets
  const downloadChunks = async () => {
    if (!downloads[hash].chunks.find((chunk) => chunk.state !== 2)) {
      // end
      console.log('end download');
      await file.close();
      await rename(downloads[hash].path, path.resolve(DOWNLOADS_PATH, downloads[hash].name))
      return;
    }

    for (let { socket } of Object.values(sockets).filter(({ busy }) => !busy)) {
      const availableChunkIndex = downloads[hash].chunks.findIndex((chunk) => chunk.state === 0);

      if (availableChunkIndex !== -1) {
        downloads[hash].chunks[availableChunkIndex].state = 1;
        // TODO timeout and error handling
        // console.log('chunk request', hash, availableChunkIndex)
        const chunk = await downloadChunk(socket, hash, availableChunkIndex);

        // console.log('Chunk downloaded', { hash, index, chunk })

        file.write(Buffer.from(chunk), 0, CHUNK_SIZE, availableChunkIndex * CHUNK_SIZE);

        downloads[hash].chunks[availableChunkIndex].state = 2;
      }
    }

    setTimeout(downloadChunks, 500);
  };

  downloadChunks();


});

// And lastly we process chunks requests
mainee.on('chunk', async ({ hash, index: i, socket }) => {
  const chunk = Buffer.alloc(CHUNK_SIZE);
  const file = await open(index.get(hash).path, 'r');

  await file.read(chunk, 0, CHUNK_SIZE, i * CHUNK_SIZE);
  await file.close();

  socket.write(JSON.stringify({ hash, index: i, chunk }));
});
