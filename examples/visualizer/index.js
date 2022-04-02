const createNode = require('../../src');
const EventEmitter = require('events');

const randomItem = (c) => c[Math.floor(Math.random() * c.length)];

// Parameters for p2p network
const NODES_COUNT = 20;
const CONNECTIONS_PER_NODE = 3;

// Since we don't have module level
// await yet, wrap stuff in an async function
;(async () => {
  //
  //  Step 1. Setup network
  //
  const nodes = [...new Array(NODES_COUNT)].map(() => createNode());

  // Start all the nodes in the network and
  // await for them to be up
  console.log('Setting nodes up...');

  await Promise.all(
    nodes.map((node, index) => {
      return new Promise((resolve) => {
        node.listen(8000 + index, () => {
          console.log(`Node #${index} listening at ${8000 + index}.`);
          resolve();
        });
      });
    })
  );

  const edges = [];
  const countAppearances = (id) => edges.filter((edge) => edge.includes(id)).length;
  const hasEdge = (edge) => !!edges.find((e) => {
    return (
      (e[0] === edge[0] && e[1] === edge[1])
      || (e[1] === edge[0] && e[0] === edge[1])
    );
  });

  nodes.forEach((node) => {
    while (countAppearances(node.NODE_ID) < CONNECTIONS_PER_NODE) {
      const secondNode = randomItem(nodes.filter((node) => countAppearances(node.NODE_ID) < CONNECTIONS_PER_NODE));

      // if (!hasEdge([node.NODE_ID, secondNode.NODE_ID])) {
        edges.push([node.NODE_ID, secondNode.NODE_ID]);
      // }
      // console.log('loop', secondNode)
    }
  });

  for (let edge of edges) {
    const firstNode = nodes.find((n) => n.NODE_ID === edge[0]);
    const secondNodeIndex = nodes.findIndex((n) => n.NODE_ID === edge[1]);

    await new Promise((resolve) => {
      firstNode.connect('127.0.0.1', 8000 + secondNodeIndex, () => {
        // console.log(`Node #${index} connected to ${randomIndex}.`);
        setTimeout(() => {
          resolve();
        }, 200);
      });
    });
  }



  // Connect each node with N other nodes
  // in a random fashion
  // await nodes.reduce(async (acc, node, index) => {
  //   await acc;
  //   let randomIndex;
  //   let connected = [];
  //
  //   // Repeate the amount of times we need each node
  //   // to be connected to others
  //   while (node.neighbors.size < Math.random() * CONNECTIONS_PER_NODE) {
  //     // Generate random index while we find the one we are not
  //     // connected to and it's not us
  //     do {
  //       randomIndex = Math.floor(Math.random() * NODES_COUNT);
  //     } while (connected.includes(randomIndex) || randomIndex === index || nodes[randomIndex].neighbors.size >= CONNECTIONS_PER_NODE);
  //
  //     connected.push(randomIndex);
  //     await new Promise((resolve) => {
  //       node.connect('127.0.0.1', 8000 + randomIndex, () => {
  //         console.log(`Node #${index} connected to ${randomIndex}.`);
  //         setTimeout(() => {
  //           resolve();
  //         }, 100);
  //       });
  //     });
  //   }
  // }, Promise.resolve());

  console.log('');
  console.log(`P2P network ${NODES_COUNT}x${CONNECTIONS_PER_NODE} is up!.`);
  console.log('');

  //
  // Step 2. Start collecting the network stats
  //

  // 1. Collect the network schema (nodes and edges)
  const stats = {
    nodes: [],
    edges: [],
    mps: 0,
  };

  setInterval(() => {
    // Fill in the nodes (basically this should not update, but I put this here for consistency)
    stats.nodes = nodes.map((node) => node.NODE_ID);

    // Fill in the edges data (and yes, each edge will appear twise)
    stats.edges = []

    nodes.forEach((node) => {
      for (let neighborNodeId of node.neighbors.keys()) {
        stats.edges.push([node.NODE_ID, neighborNodeId]);
      }
    });
  }, 200);

  //
  // A place for strategies and tests
  //

  // const strateg = new EventEmitter();
  let messagesSent = 0;

  // Join all nodes direct handlers
  // into one event for easier testing
  // nodes.forEach((node) => {
  //   node.on('direct', ({ origin, message }) => {
  //     strateg.emit('resolve', { origin });
  //   });
  // });

  const sendRandomMessage = () => new Promise((resolve) => {
    const nodeFrom = Math.floor(Math.random() * NODES_COUNT);
    const nodeTo   = Math.floor(Math.random() * NODES_COUNT);

    nodes[nodeTo].once('direct', ({ origin }) => {
      if (origin === nodes[nodeFrom].NODE_ID) {
        resolve();
      }
    });

    nodes[nodeFrom].direct(nodes[nodeTo].NODE_ID, 'dummy data');
  });

  setInterval(() => {
    stats.mps = Math.floor((messagesSent + 3 * stats.mps) / 4);
    messagesSent = 0;
  }, 1000);

  ;(async () => {
    while (true) {
      await sendRandomMessage();
      messagesSent++;
    }
  })();


  // nodes[1].on('direct',({ origin, message }) => {
  //   console.log({ origin, message }, nodes[0].NODE_ID)
  // });
  // nodes[0].direct(nodes[1].NODE_ID, 'something');



  //
  // /A place
  //

  //
  // Step 3. Setup an http server to display network visualization
  //

  const http = require('http');
  const fs = require('fs');
  const path = require('path');

  // create a server object:
  const server = http.createServer(function (req, res) {
    if (req.url === '/stats') {
      res.write(JSON.stringify(stats));
      res.end();
    } else if (req.url === '/client.js') {
      fs.createReadStream(path.resolve(__dirname, './client.js')).pipe(res);
    } else {
      fs.createReadStream(path.resolve(__dirname, './index.html')).pipe(res);
    }
  }).listen(7999, () => {
    console.log('Server is up at 7999')
  });

  //
  // Handle CTRL C to gracefully shut everything down
  //
  process.on('SIGINT', async () => {
    console.log("\nGracefully shutting everything down...");

    // // Shut down the network http server
    // await new Promise((resolve) => {
    //   if (server) {
    //     server.close(() => {
    //       resolve();
    //     });
    //   } else {
    //     resolve();
    //   }
    // });
    //
    // // Shut down the network
    // await Promise.all(nodes.map((node) => {
    //   return new Promise((resolve) => {
    //     node.close(() => {
    //       resolve();
    //     });
    //   });
    // }));

    process.exit();
  });
})();
