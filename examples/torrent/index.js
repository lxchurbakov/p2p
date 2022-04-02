//
// Minimal Torrent application using swenssonp2p library
// uses p2p network to exchange files information and
// creates TCP connection to peers to download data
//
const path = require('path');
const { readdir, stat } = require('fs/promises');
const { createReadStream } = require('fs');
const { createHash } = require('crypto');
const { Writable } = require('stream');
const EventEmitter = require('events');

// Little generator to help us grab files
// from the folder and all it's subfolders
async function* findFiles (folder) {
  for (let filename of await readdir(folder)) {
    const filepath = path.resolve(folder, filename);
    const filestats = await stat(filepath);

    if (filestats.isDirectory()) {
      yield* findFiles(filepath);
    } else {
      yield filepath;
    }
  }
}

// A helper to get file hash. Uses strems, but
// also adds a little hack to the table
const hashFile = (filepath) => new Promise((resolve) => {
  createReadStream(filepath).pipe(createHash('sha256')).setEncoding('hex').pipe(new Writable({
    write (chunk, enc, next) {
      resolve(chunk.toString());
    },
  }));
});

// Another helper to format filesize with a right suffix
const formatSize = (size) => {
  const suffixes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let suffixIndex = 0;

  while (size >= 1024) {
    size = size / 1024;
    suffixIndex++;
  }

  return `${size.toFixed(2)}${suffixes[suffixIndex]}`;
};

// Instance of files index to keep all the information
// about them in one place
const index = new Map();

// A main method to fill the index with data,
// accepts the filepath, grabs the hashsum and
// puts the data to the index
const indexFile = async (filepath) => {
  const [filename] = filepath.split('/').slice(-1);
  const filehash = await hashFile(filepath);
  const filesize = (await stat(filepath)).size;

  index.set(filename, { filesize, filehash, filepath });
};

// First of all, let's kick off the indexing process
// We don't want that to pause the main flow, so we kick
// it off in a separate function
;(async () => {
  console.log('Start indexing files...');
  for await (let filepath of findFiles(process.cwd())) {
    indexFile(filepath);
  }
  console.log('Directory content indexed.');
})();

// Now, let's create a node and emit event.
// We delay the listen to let all the subscribes happen
const mainee = new EventEmitter();
const createNode = require('../../src');

const node = createNode();
const port = Number(process.argv[2]);

setTimeout(() => {
  node.listen(port, () => {
    mainee.emit('node-up', port);
  });
}, 0);

// After the node is up, we need to provide user
// with instructions, let's do it. Each instruction
// is going to be listed below this piece of code as
// separate "plugin"
mainee.on('node-up', (port) => {
  console.log(`P2P node is up on ${port}.`);
  console.log('');
  // console.log(`Write "connect IP:PORT" to connect to other nodes.`);
  // console.log(`Write "search FILE" to search for file`);
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
      if (key.toLowerCase().includes(searchRequest.toLowerCase())) {
        node.direct(origin, { type: 'search/result', meta: { key, data: index.get(key) } });
      }
    }
  }
});

// And eventually, when search results arrive, we post them to console
node.on('direct', ({ origin, message: { type, meta }}) => {
  if (type === 'search/result') {
    console.log(`  ${meta.key} ${formatSize(meta.data.filesize)} ${meta.data.filehash}`);
  }
});

// After we have performed search, we may need to download the file
// in order to do so, we have to obtain filehash, look it up on the
// network in order to find all the users that may have it, connect
// to them via tcp and start requesting chunks. To do this stuff, I
// need to create a "download manager", that will hold the space on
// the disk, write chunks to them and notify other parts of the app
// when the download is finished




// console.log('node is up at', port);
//
// console.log(``);
// console.log(`Write "connect IP:PORT" to connect to other nodes.`);
// console.log(`Write "search FILE" to search for file`);
// // console.log(`Type anything else to send it to everyone on the network`);
// console.log(``);
// // console.log(`Your name is "${name}"`);
//
// process.stdin.on('data', (data) => {
//   const text = data.toString().trim();
//
//   if (text.startsWith('connect')) {
//
//   } else if (text.startsWith('search')) {
//     const request = text.substr(7);
//
//     console.log('search for', request);
//
//     node.broadcast({ type: 'search', meta: request });
//     // const [ip, port] = ipport.split(':');
//     //
//     // console.log(`Connecting to ${ip} at ${Number(port)}...`);
//     // node.connect(ip, Number(port), () => {
//     //   console.log(`Connection to ${ip} established.`);
//     // });
//   // } else if (text.startsWith('name')) {
//   //   [,name] = text.split(' ');
//   //   console.log(`Name changed to "${name}"`);
//   // } else {
//   //   node.broadcast({ name, text });
//   //   console.log(`${"\033[F"}You: ${text}`);
//   }
// });
//
// node.on('direct', ({ origin, message: { type, meta }}) => {
//   if (type === 'search-result') {
//     console.log('Search result from', origin, meta.key, meta.data)
//   }
// });
//
// node.on('broadcast', ({ origin, message: { type, meta }}) => {
//   if (origin !== node.NODE_ID) {
//     if (type === 'search') {
//       // console.log()
//       for (let key of filesIndex.keys()) {
//         if (key.toLowerCase().includes(meta.toLowerCase())) {
//           node.direct(origin, { type: 'search-result', meta: { key, data: filesIndex.get(key) } });
//         }
//         // console.log({ key })
//       }
//     }
//   }
//
//   // console.log('broadcast', type, meta)
//
// });



