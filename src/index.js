const net = require('net');
const EventEmitter = require('events');
const splitStream = require('./split-stream');

const random4digithex = () => Math.random().toString(16).split('.')[1].substr(0, 4);
const randomuuid = () => new Array(8).fill(0).map(() => random4digithex()).join('-');

module.exports = (options) => {
  //
  // Layer 1 - handle all the established connections, store
  // them in a map and emit corresponding events
  //
  const connections = new Map();
  const emitter = new EventEmitter();

  // Handle all TCP connections same way, no matter
  // if it's incoming or outcoming, we're p2p
  const handleNewSocket = (socket) => {
    const connectionId = randomuuid();

    connections.set(connectionId, socket);
    emitter.emit('_connect', connectionId);

    socket.on('close', () => {
      connections.delete(connectionId);
      emitter.emit('_disconnect', connectionId);
    });

    socket.pipe(splitStream()).on('data', (message) => {
      emitter.emit('_message', { connectionId, message });
    });
  };

  // Create a server itself and make it able to handle
  // all new connections and put the to the connections map
  const server = net.createServer((socket) => handleNewSocket(socket));

  // A method to "raw" send data by the connection ID
  // intended to internal use only
  const _send = (connectionId, message) => {
    const socket = connections.get(connectionId);

    if (!socket) {
      throw new Error(`Attempt to send data to connection that does not exist ${connectionId}`);
    }

    socket.write(JSON.stringify(message));
  };

  // A method for the libabry consumer to
  // esstablish connection to other nodes
  const connect = (ip, port, cb) => {
    const socket = new net.Socket();

    socket.connect(port, ip, () => {
      handleNewSocket(socket);
      cb && cb();
    });

    // Return a disconnect function so you can
    // exclude the node from the list
    return (cb) => socket.destroy(cb);
  };

  // A method to actually start the server
  const listen = (port, cb) => {
    server.listen(port, '0.0.0.0', cb);

    return (cb) => server.close(cb);
  };

  // One method to close all open connections
  // and server itself
  const close = (cb) => {
    for (let [connectionId, socket] of connections) {
      socket.destroy();
    }

    server.close(cb);
  };

  //
  // Layer 2 - create Nodes, assign IDs, handshake
  // and keep neighbors in a collection
  //
  const NODE_ID = randomuuid();
  const neighbors = new Map();

  // A helper to find node id by connection id
  const findNodeId = (connectionId) => {
    for (let [nodeId, $connectionId] of neighbors) {
      if (connectionId === $connectionId) {
        return nodeId;
      }
    }
  };

  // Once connection is established, send the handshake message
  emitter.on('_connect', (connectionId) => {
    _send(connectionId, { type: 'handshake', data: { nodeId: NODE_ID } });
  });

  // On message we check whether it's a handshake and add
  // the node to the neighbors list
  emitter.on('_message', ({ connectionId, message }) => {
    const { type, data } = message;

    if (type === 'handshake') {
      const { nodeId } = data;

      neighbors.set(nodeId, connectionId);
      emitter.emit('connect', { nodeId });
    }

    if (type === 'message') {
      const nodeId = findNodeId(connectionId);

      // TODO handle no nodeId error

      emitter.emit('message', { nodeId, data });
    }
  });

  emitter.on('_disconnect', (connectionId) => {
    const nodeId = findNodeId(connectionId);

    // TODO handle no nodeId

    neighbors.delete(nodeId);
    emitter.emit('disconnect', { nodeId });
  });

  // Finally we send data to the node
  // by finnding it's connection and using _send
  const send = (nodeId, data) => {
    const connectionId = neighbors.get(nodeId);

    // TODO handle no connection id error

    _send(connectionId, { type: 'message', data });
  };

  //
  // Layer 3 - here we can actually send data OVER
  // other nodes by doing recursive broadcast
  //
  const alreadySeenMessages = new Set();

  // A method to send packet to other nodes (all neightbors)
  const sendPacket = (packet) => {
    for (const $nodeId of neighbors.keys()) {
      send($nodeId, packet);
    }
  };

  // 2 methods to send data either to all nodes in the network
  // or to a specific node (direct message)
  const broadcast = (message, id = randomuuid(), origin = NODE_ID, ttl = 255) => {
    sendPacket({ id, ttl, type: 'broadcast', message, origin });
  };

  const direct = (destination, message, id = randomuuid(), origin = NODE_ID, ttl = 255) => {
    sendPacket({ id, ttl, type: 'direct', message, destination, origin });
  };

  // Listen to all packets arriving from other nodes and
  // decide whether to send them next and emit message
  emitter.on('message', ({ nodeId, data: packet }) => {
    // First of all we decide, whether this message at
    // any point has been send by us. We do it in one
    // place to replace with a strategy later TODO
    if (alreadySeenMessages.has(packet.id) || packet.ttl < 1) {
      return;
    } else {
      alreadySeenMessages.add(packet.id);
    }

    // Let's pop up the broadcast message and send it
    // forward on the chain
    if (packet.type === 'broadcast') {
      emitter.emit('broadcast', { message: packet.message, origin: packet.origin });
      broadcast(packet.message, packet.id, packet.origin, packet.ttl - 1);
    }

    // If the peer message is received, figure out if it's
    // for us and send it forward if not
    if (packet.type === 'direct') {
      if (packet.destination === NODE_ID) {
        emitter.emit('direct', { origin: packet.origin, message: packet.message });
      } else {
        direct(packet.destination, packet.message, packet.id, packet.origin, packet.ttl - 1);
      }
    }
  });

  return {
    listen, connect, close,
    broadcast, direct,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    id: NODE_ID,
    neighbors: () => neighbors.keys(),
  };
};
