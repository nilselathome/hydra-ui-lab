import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js";

const canvas = document.getElementById("hydraCanvas");
const hydra = new Hydra({ canvas });

const params = {};
const pane = new Pane();
let chain = [];

// metadata for effects
const effectDefinitions = {
  osc: {
    args: [
      { key: "frequency", min: 0, max: 32, default: 3.47 },
      { key: "sync", min: 0, max: 1, default: 0.13 },
      { key: "offset", min: -1, max: 1, default: -1 },
    ],
  },
  rotate: {
    args: [{ key: "rotate", min: 0, max: 1, default: 0.01 }],
  },
  kaleid: {
    args: [{ key: "kaleidSides", min: 1, max: 12, default: 3 }],
  },
};

function addEffect(fn) {
  const def = effectDefinitions[fn];
  if (!def) return;

  def.args.forEach((arg) => {
    if (!(arg.key in params)) {
      params[arg.key] = arg.default;
      pane.addBinding(params, arg.key, { min: arg.min, max: arg.max })
          .on("change", render);
    }
  });

  chain.push({ fn, args: def.args.map((a) => a.key) });
  render();
  renderChainUI();
}



function renderChainUI() {
  const chainEl = document.getElementById("chain");
  chainEl.innerHTML = "";

  chain.forEach((step, index) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "0.5rem";
    row.style.alignItems = "center";
    row.style.margin = "0.25rem 0";
    row.style.fontFamily = "monospace";
    row.style.color = "white";

    const label = document.createElement("span");
    label.textContent = step.fn;

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.onclick = () => {
      if (index > 0) {
        [chain[index - 1], chain[index]] = [chain[index], chain[index - 1]];
        render();
        renderChainUI();
      }
    };

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.onclick = () => {
      if (index < chain.length - 1) {
        [chain[index + 1], chain[index]] = [chain[index], chain[index + 1]];
        render();
        renderChainUI();
      }
    };

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.onclick = () => {
      chain.splice(index, 1);
      render();
      renderChainUI();
    };

    row.append(label, upBtn, downBtn, removeBtn);
    chainEl.appendChild(row);
  });
}


function render() {
  let node;
  chain.forEach((step, i) => {
    const args = step.args.map((a) => params[a]);
    if (i === 0) node = window[step.fn](...args);
    else node = node[step.fn](...args);
  });
  node.out();
}

// hook buttons
document.getElementById("addOsc").onclick = () => addEffect("osc");
document.getElementById("addRotate").onclick = () => addEffect("rotate");
document.getElementById("addKaleid").onclick = () => addEffect("kaleid");

// start with osc by default
addEffect("osc");
