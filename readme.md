# swenssonp2p

Lightweight library that will let you create a p2p network with ease.

## Usage

```
const createp2pnode = require('@swensson/p2p');

const node = createp2pnode();

// Start listening to connections
node.listen(PORT, () => {
  console.log('Listening to connections...');
});

// Connect to other nodes
node.connect(IP, PORT, () => {
  console.log('Connected to some other node.');
});

// Send message to everyone
// data can be anything that
// you can JSON.stringify
node.broacast(data);

// Send message to specific node
// data can be anything that
// you can JSON.stringify
node.direct(recipientId, data);

// Some other node has connected to
// us (neighbor)
node.on('connect', ({ nodeId }) => {
  console.log('Node', nodeId, 'has connected');
});

// Neighbor has disconnected
node.on('disconnect', ({ nodeId }) => {
  console.log('Node', nodeId, 'has disconnected');
});

// Some message has been broadcasted somewhere
// on the network and has reached us
node.on('broadcast', ({ origin, message }) => {
  console.log('Message', message, 'has been broadcasted from', origin);
});

// Some message has been sent to us
node.on('direct', ({ origin, message }) => {
  console.log('Message', message, 'has been directly send to us from', origin);
});

// Shut down node
node.close(() => {
  console.log('Node is down');
});
```

## Examples

### Chat

Run chat application with `node examples/chat PORT`. If you want to test it locally, run several instances of the chat and connect them using `connect IP:PORT` to any other instances, creating a p2p network. Send a message simply typing anything in the console.

### Torrent

See more about torrent application [here](https://github.com/swensson/swenssonp2p/tree/master/examples/torrent).

## Other

[There is an article about this repo.](https://dev.to/swensson/create-a-p2p-network-with-node-from-scratch-1pah)
