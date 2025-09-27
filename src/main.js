import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';


const canvas = document.getElementById("hydraCanvas");
const hydra = new Hydra({ canvas });

const params = {
  frequency: 3.47,
  sync: 0.13,
  offset: -1,
  rotate: 0.01,
};

const pane = new Pane();
pane.addBinding(params, "frequency", { min: 0, max: 32 });
pane.addBinding(params, "sync", { min: 0, max: 1 });
pane.addBinding(params, "offset", { min: -1, max: 1 });
pane.addBinding(params, "rotate", { min: 0, max: 1 });

function render() {
  // osc(params.frequency, params.sync, params.offset).out();

// wooohoooo! "just" wire up more controls lol
// licensed with CC BY-NC-SA 4.0 https://creativecommons.org/licenses/by-nc-sa/4.0/
// by Olivia Jack


// nilsel remix
osc(params.frequency, 0.01, 1.9)
  .rotate(Math.sin(0.21*time))
  .kaleid(5)
  .mult(osc(30, 0.2, 1).rotate(time / params.rotate))
  .blend(o0, 0.55)
  .modulateScale(osc(20, 1), /*-0.04*/ params.sync)
  .scale(0.95,
         () => (
  		1.05 * Math.sin(0.05*time))
        )
.out(o0)
}

pane.on("change", render);
render();
