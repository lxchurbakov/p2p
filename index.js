const net = require('net');
const EventEmitter = require('events');

const random4digithex = () => Math.random().toString(16).split('.')[1].substr(0, 4);
const randomuuid = () => new Array(8).fill(0).map(() => random4digithex()).join('-');

const startup = (options) => {
  const connections = new Map();
  const emitter = new EventEmitter();

  const handleNewSocket = (socket) => {
    const connectionId = randomuuid();

    connections.set(connectionId, socket);
    emitter.emit('connect', connectionId);

    socket.on('close', () => {
      connections.delete(connectionId);
      emitter.emit('disconnect', connectionId);
    });

    socket.on('data', (data) => {
      emitter.emit('message', { connectionId, message: JSON.parse(data.toString()) });
    });
  };

  // Create a server itself and make it able to handle
  // all new connections and put the to the connections map
  const server = net.createServer((socket) => {
    handleNewSocket(socket);
  });

  const send = (connectionId, message) => {
    const socket = connections.get(connectionId);

    if (!socket) {
      throw new Error(`Attempt to send data to connection that does not exist ${connectionId}`);
    }

    socket.write(JSON.stringify(message));
  };

  const connect = (ip, port, cb) => {
    const socket = new net.Socket();

    socket.connect(port, ip, () => {
      handleNewSocket(socket);
      cb();
    });
  };

  const listen = (port, cb) => {
    server.listen(port, '0.0.0.0', cb);
  };



  const NODE_ID = randomuuid();
  const neighbors = new Map();

  const findNodeId = (connectionId) => {
    for (let [nodeId, $connectionId] of neighbors) {
      if (connectionId === $connectionId) {
        return nodeId;
      }
    }
  };

  emitter.on('connect', (connectionId) => {
    send(connectionId, { type: 'handshake', data: { nodeId: NODE_ID } });
  });

  emitter.on('message', ({ connectionId, message }) => {
    const { type, data } = message;

    if (type === 'handshake') {
      const { nodeId } = data;

      neighbors.set(nodeId, connectionId);
      emitter.emit('node-connect', { nodeId });
    }

    if (type === 'message') {
      const nodeId = findNodeId(connectionId);

      emitter.emit('node-message', { nodeId, data });
    }
  });

  emitter.on('disconnect', (connectionId) => {
    const nodeId = findNodeId(connectionId);

    neighbors.delete(nodeId);
    emitter.emit('node-disconnect', { nodeId });
  });


  const nodesend = (nodeId, data) => {
    const connectionId = neighbors.get(nodeId);

    if (!connectionId) {
      // error treatment for you
    }

    send(connectionId, { type: 'message', data });
  };


  const oversent = new Set();

  const p2psend = (data) => { // has to has ttl and id
    if (data.ttl < 1) {
      return;
    }

    for (const $nodeId of neighbors.keys()) {
      nodesend($nodeId, data);
      oversent.add(data.id);
    }
  };

  const broadcast = (message, id = randomuuid(), origin = NODE_ID, ttl = 1000) => {
    p2psend({ id, ttl, type: 'broadcast', message, origin });
  };

  const dm = (destination, message, origin = NODE_ID, ttl = 10, id = randomuuid()) => {
    p2psend({ id, ttl, type: 'dm', message, destination, origin });
  };

  emitter.on('node-message', ({ nodeId, data }) => {
    // If we didn't send this message out recently
    if (!oversent.has(data.id)) {
      // Let's pop up the broadcast message and send it
      // forward on the chain
      if (data.type === 'broadcast') {
        emitter.emit('broadcast', { message: data.message, origin: data.origin });
        broadcast(data.message, data.id, data.origin, data.ttl - 1);
      }

      // If the peer message is received, figure out if it's
      // for us and send it forward if not
      if (data.type === 'dm') {
        if (data.destination === NODE_ID) {
          emitter.emit('dm', { origin: data.origin, message: data.message });
        } else {
          peer(data.destination, data.message, data.origin, data.ttl - 1, data.id);
        }
      }
    }
  });

  listen(options.port);

  return {
    broadcast, dm, on: emitter.on, connect,
    close: (cb) => {
      server.close(cb);
    },
  };
};
