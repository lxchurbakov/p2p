const createNode = require('../../src');
const EventEmitter = require('events');

// Parameters for p2p network
const NODES_COUNT = 20;
const CONNECTIONS_PER_NODE = 1;

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

  // Connect each node with N other nodes
  // in a random fashion
  await Promise.all(nodes.map(async (node, index) => {
    let randomIndex;
    let connected = [];

    // Repeate the amount of times we need each node
    // to be connected to others
    for (let _ of [...new Array(CONNECTIONS_PER_NODE)]) {
      // Generate random index while we find the one we are not
      // connected to and it's not us
      do {
        randomIndex = Math.floor(Math.random() * NODES_COUNT);
      } while (connected.includes(randomIndex) || randomIndex === index);

      connected.push(randomIndex);
      await new Promise((resolve) => {
        node.connect('127.0.0.1', 8000 + randomIndex, () => {
          console.log(`Node #${index} connected to ${randomIndex}.`);
          resolve();
        });
      });
    }
  }));

  console.log('');
  console.log(`P2P network ${NODES_COUNT}x${CONNECTIONS_PER_NODE} is up!.`);
  console.log('');

  //
  // Step 2. Start collecting the network stats
  //

  // 1. Collect the network schema (nodes and edges)
  const stats = {
    nodes: [],
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
