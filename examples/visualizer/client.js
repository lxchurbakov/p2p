// Couple of handlers
const fetchStats = () => fetch('/stats').then((data) => data.json());
const distance = (a, b) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

//
// Setup canvas for rendering
//
const canvas = document.getElementById('main-screen');

if (!canvas) {
  //
}

const { width, height } = canvas.getBoundingClientRect();
const pixelDensity = window.devicePixelRatio || 1.0

canvas.width = width * pixelDensity;
canvas.height = height * pixelDensity;;

const context = canvas.getContext('2d');

context.scale(pixelDensity, pixelDensity);



//
// Start rendering cycle
//

// type Point = { x: number, y: number };
// type Vector = { x: number, y: number };

// let nodes = [{ x:100, y: 100}, { x:101, y: 101 }, { x:102, y: 102 }];
let nodes = {};
let edges = [];

const updateState = async () => {
  const stats = await fetchStats();

  // enter/update nodes
  stats.nodes.forEach((id) => {
    nodes[id] = nodes[id] || { x: Math.random() + width / 2, y: Math.random() + height / 2 };
  });

  // exit nodes
  Object.keys(nodes).forEach((id) => {
    if (!stats.nodes.includes(id)) {
      delete nodes[id];
    // } else {
    //   delete nodes[id];
    }
  });

  // simply copy edges
  edges = stats.edges;
};

setInterval(() => {
  updateState();
}, 1000);

updateState();

const updateView = () => {
  // Nodes push further from each other
  for (let i of Object.keys(nodes)) {
    for (let j of Object.keys(nodes)) {
      if (i !== j) {
        const factor = 200 / Math.pow(distance(nodes[i], nodes[j]), 2);

        nodes[i].x += factor * (nodes[i].x - nodes[j].x);
        nodes[i].y += factor * (nodes[i].y - nodes[j].y);
      }
    }
  }

  // Edges push nodes closer
  for (let [i, j] of edges) {
    const factor = .000001 * Math.pow(distance(nodes[i], nodes[j]), 2);

    nodes[i].x -= factor * (nodes[i].x - nodes[j].x);
    nodes[i].y -= factor * (nodes[i].y - nodes[j].y);
  }

  // Canvas edges push nodes further from them
  for (let i of Object.keys(nodes)) {
    const horizontalForce = .000001 * Math.pow(nodes[i].x - width / 2, 2);
    const verticalForce = .000001 * Math.pow(nodes[i].y - height / 2, 2);

    nodes[i].x -= horizontalForce * (nodes[i].x - width / 2);
    nodes[i].y -= verticalForce * (nodes[i].y - height / 2);
  }
};

const render = () => {
  updateView();

  context.clearRect(0, 0, width, height);

  edges.forEach(([from, to]) => {
    const nodeFrom = nodes[from];
    const nodeTo = nodes[to];

    context.beginPath();
    context.moveTo(nodeFrom.x, nodeFrom.y);
    context.lineTo(nodeTo.x, nodeTo.y);
    context.stroke();
  });

  Object.entries(nodes).forEach(([id, { x, y }]) => {
    context.beginPath();
    context.arc(x, y, 16, 0, Math.PI * 2);
    context.fillStyle = '#74ccf7';
    context.fill();

    context.textAlign = 'center';
    context.fillStyle = '#333';
    context.font = 'bold 21px monospace';
    context.fillText(id.substr(0, 4).toUpperCase(), x, y + 6);
  });

  requestAnimationFrame(render);
};

requestAnimationFrame(render);