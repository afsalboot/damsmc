import { mkdir, writeFile } from "node:fs/promises";
export async function benchmarkCheckout({ mode, evaluate, action, waitFor, requests, blocked }) {
  await waitFor("Boolean(document.querySelector('.sales-product-card') && !document.querySelector('.sales-product-card').textContent.includes('Loading stock'))");
  await action("document.querySelector('.sales-product-card').click()", "Boolean(document.querySelector('.sales-cart-item') || [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Add to sale'))");
  if (await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Add to sale' && !b.disabled)")) await action("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Add to sale' && !b.disabled).click()", "Boolean(document.querySelector('.sales-cart-item'))");
  const samples = [];
  const clickMethod = label => `[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`;
  const setInput = (selector, value) => `const input=${selector};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))`;
  for (let cycle = 0; cycle < 5; cycle++) {
    const before = requests.length;
    const opening = await action("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Proceed to Payment')).click()", "Boolean(document.querySelector('[role=dialog][aria-labelledby=checkout-title]'))");
    const due = await evaluate("Number(document.querySelector('[role=dialog] input[type=number]').min)");
    const cash = await action(setInput("document.querySelector('[role=dialog] input[type=number]')", String(due + 10 + cycle)));
    const cashValid = await evaluate("![...document.querySelectorAll('[role=dialog] button')].find(b=>b.type==='submit').disabled");
    const upi = await action(clickMethod("UPI"));
    const reference = await action(setInput("document.querySelector('[role=dialog] input:not([type=number])')", "BENCHMARK-NOT-A-PAYMENT"));
    const split = await action(clickMethod("Split"));
    const splitCash = await action(setInput("document.querySelectorAll('[role=dialog] input[type=number]')[0]", String(due / 2)));
    const splitUpi = await action(setInput("document.querySelectorAll('[role=dialog] input[type=number]')[1]", String(due - due / 2)));
    const splitValid = await evaluate("![...document.querySelectorAll('[role=dialog] button')].find(b=>b.type==='submit').disabled");
    const cancel = await action("document.querySelector('[aria-label=\"Close checkout\"]').click()", "!document.querySelector('[role=dialog][aria-labelledby=checkout-title]')");
    samples.push({ cycle: cycle + 1, opening, cash, cashValid, upi, reference, split, splitCash, splitUpi, splitValid, cancel, requests: requests.slice(before) });
  }
  const median = values => values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary = Object.fromEntries(["opening", "cash", "upi", "reference", "split", "splitCash", "splitUpi", "cancel"].map(key => [key, { medianDomMs: median(samples.map(s=>s[key].domMs)), medianPaintMs: median(samples.map(s=>s[key].paintMs)) }]));
  const result = { mode, origin: "http://localhost:3000", build: "local production", noSubmission: true, blocked, samples, summary, requests };
  await mkdir("performance-results", { recursive: true }); await writeFile(`performance-results/checkout-${mode}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ mode, summary, blocked, cashValid: samples.every(s=>s.cashValid), splitValid: samples.every(s=>s.splitValid) }, null, 2));
}
