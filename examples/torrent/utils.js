const { readdir, stat } = require('fs/promises');
const path = require('path');
const { createReadStream } = require('fs');
const { createHash } = require('crypto');
const { Writable } = require('stream');

const random4digithex = () => Math.random().toString(16).split('.')[1].substr(0, 4);
const randomuuid = () => new Array(8).fill(0).map(() => random4digithex()).join('-');

// const messages = data.toString().split('}s{');
//
// if (messages.length > 1) {
//   for (let i = 0; i < messages.length - 1; ++i) {
//     messages[i] += '}s';
//   }
//   for (let i = 1; i < messages.length; ++i) {
//     messages[i] = '{' + messages[i];
//   }
// }
//
// messages.forEach((m) => {
//   emitter.emit('_message', { connectionId, message: JSON.parse(m.substr(0, m.length - 1)) });
// });

// Split messages
// TODO this will break if someone will send a string
// containing }s{ - this needs to be fixed
const splitjson = (data) => {
  const messages = data.toString().split('}s{');

  if (messages.length > 1) {
    for (let i = 0; i < messages.length - 1; ++i) {
      messages[i] += '}s';
    }
    for (let i = 1; i < messages.length; ++i) {
      messages[i] = '{' + messages[i];
    }

    return messages.map((m) => JSON.parse(m.substr(0, m.length - 1)));
  } else {
    return messages.map((m) => JSON.parse(m));
  }


};

const delay = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

// Little generator to help us grab files
// from the folder and all it's subfolders
async function* findFiles (folder) {
  for (let filename of await readdir(folder)) {
    const filepath = path.resolve(folder, filename);
    const filestats = await stat(filepath);

    if (filestats.isDirectory()) {
      yield* findFiles(filepath);
    } else {
      yield { path: filepath, size: filestats.size };
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

module.exports = { findFiles, hashFile, formatSize, splitjson, delay, randomuuid };
