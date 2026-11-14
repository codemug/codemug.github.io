// The overlay texts of the calculator, one per key. Markup points at a key with
// data-tip="key"; {name} is filled at run time from tip-facts.mjs, so every
// number comes from the data or the current result. Plain ASCII only: no
// dashes, no curly quotes. Keep each text to one to three short sentences.

export const TIPS = {
  // Top of the results
  'headline': 'The two monthly bills side by side for {C} parallel streams. It says how many times cheaper or dearer self-hosting is, and "about the same" when the bills are within 5% of each other.',
  'warning': 'A warning about the setup you chose. It appears when even one request alone cannot reach the speed per stream you asked for, or when an agent loop reaches more tokens than the model\'s window.',
  'scale': 'Logarithmic means each gridline is 10 times the one before, so the whole range from 0.01 to 10,000 streams fits, and a straight rising line means the cost grows in proportion. Linear means equal steps, so you see the real shape: the API bill is a straight line through zero and self-hosting is a staircase.',
  'crossover': 'The number of parallel streams from which self-hosting costs less than the API. Below that, the machines would sit partly idle, so paying per token is cheaper. It is worked out at the expected speed and at both ends of the accuracy band.',
  'captured': 'Prices and specs are a snapshot taken on {captured}. Prices move, so look at the provider before you commit. A price change that is already scheduled shows as a note and is never applied early.',

  // Form groups
  'fs.workload': 'Describe one typical request. Simple splits the context into cached input, new input and output for you. Detailed lets you set that split yourself, or model an agent that works in turns.',
  'fs.traffic': 'How busy the system is: how many requests run at the same moment, how fast each one should be, and for how many hours a day.',
  'fs.api': 'Which API price to compare against.',
  'fs.model': 'The open-weight model you would run on your own GPUs, and how it is stored.',
  'fs.self': 'How you would get the GPUs: rent machines by the hour, or buy servers.',

  // Workload
  'shape.simple': 'Every request holds the same number of tokens in total, and you give that one number. Every request is split {simpleSplit}. Switch to Detailed to change the split.',
  'shape.detailed': 'Set the split of the context yourself, or model an agent that works in turns. Either way the page turns it into one request of {isl} input tokens ({cachedPct} of the input cached) and {osl} output tokens.',
  'detail': 'How one request is built. A custom split divides the context length into cached input, new input and output by percentages. An agent loop models a task of many turns, where each turn sends the whole conversation so far.',
  'detail.split': 'Give the context length and say what share of it is cached input and what share is output. The rest is new input, billed at the full input price. Memory is reserved for the whole context length of every request.',
  'detail.loop': 'A coding-agent style task with many turns. Each turn sends the whole conversation so far, so later turns are bigger. The page turns the loop into one average request of {isl} input tokens ({cachedPct} cached) and {osl} output tokens.',
  'split.cached': 'The share of the context that is input sent before, billed at the cached price. It cannot be more than the output leaves, because cached input, new input and output add up to the whole context. {apiCachedNow}',
  'split.output': 'The share of the context that the model writes, from 0.1% to 99%. The API bills it at the output price, and a longer answer keeps each request busy for longer.',
  'split.new': 'What is left of the context after the cached input and the output: new input, billed at the full input price. You do not set it, it follows the other two. Right now that is {newTokens} tokens per request.',
  'a.c0': 'The tokens the agent starts with on turn one: its instructions, its tools and the task itself.',
  'a.d': "Tokens added to the conversation on every turn by tools and by the user, not counting the model's own answer.",
  'a.o': 'Tokens the model writes on each turn. They join the conversation too, so the next turn has to read them again.',
  'a.N': 'How many turns one task takes. The more turns, the longer the conversation grows, and the bigger the average request.',
  'a.caching': 'When on, everything sent on earlier turns is billed at the cached price on the next turn, and only the new tokens pay full price. Turn it off to see what the loop costs with no caching.',

  // Traffic
  'C': 'The average number of requests being answered at the same moment: 100 means 100 people or agents getting tokens at once, and 0.1 means a request is being answered a tenth of the time, for example 6 minutes of every hour. Below 1 the API bill shrinks with usage, while a GPU costs the same however little it is used, which is why self-hosting only pays for a steady load. At {C} that is about {reqPerHour} requests an hour.',
  'C.slider': 'Drag to set the parallel streams, from 0.01 to 10,000. The scale is logarithmic, so each step along the slider multiplies the number instead of adding to it.',
  'v': 'How many tokens per second each stream should get. At {v}, an answer of {osl} tokens takes about {reqSeconds} seconds, including {ttft} seconds to start. A higher speed fits fewer streams on one GPU, so self-hosting needs more machines. {maxSpeedNote}',
  'hours': 'How many hours a day the load runs. The API and rented machines are billed for these hours only. A bought server is billed for all 24, every day.',

  // API
  'api': "Which API to price the same tokens on. The like-for-like option prices the same model on an API, on its maker's own API or at the median of several hosts. The Claude, OpenAI and Gemini options are different, larger models, so they compare tokens and not quality. {apiNow}",

  // Model
  'model': 'The open-weight model you would run yourself. It sets how much GPU memory the weights need and how much memory each request takes. {modelNow}',
  'bits': 'How compactly the model is stored, in bits per weight. Fewer bits make a smaller file, so fewer GPUs hold it and each step reads less. The page does not measure answer quality. {bitsNow}',
  'bits.4': '4 bits per weight stores the model in the least space. {bits4}',
  'bits.8': '8 bits per weight is the middle size. {bits8}',
  'bits.16': '16 bits per weight is the original, full-size version. {bits16}',
  'ctx': 'How many tokens every request holds in total, input and output together. Memory for every parallel request is reserved up front at this full size, which is deliberately the worst case: real agents that stay shorter need fewer machines. In Simple mode every request is split {simpleSplit}; Detailed lets you change that. {ctxNow}',

  // Self-hosting
  'mode': 'Rent GPUs by the hour, or buy servers. Renting bills only the hours under load. A bought server costs the same every hour of the month.',
  'mode.rent': 'Rent whole machines from a cloud by the hour. You pay for the hours under load ({hours} a day here), and a machine with spare GPUs still bills in full.',
  'mode.buy': 'Buy servers and run them yourself. The monthly figure spreads each server price over {amortYears} years and adds electricity, rack space and support. It is billed for all 24 hours, every day.',
  'provider': 'Which cloud to rent from. Prices are the published on-demand price, or the 1-year or 3-year commitment price where the provider sells one.',
  'machine': 'One rentable box with a fixed number of GPUs. You pay for the whole box, whatever share of its GPUs you use, and one copy of the model never spans two boxes. Boxes with too few GPUs are greyed out. {machineNow}',
  'term': 'On demand means pay as you go. A commitment is cheaper per hour, but in real life it bills every hour, while this page counts only the hours under load. Set hours per day to 24 to compare fairly. {termNow}',
  'term.on_demand': 'On demand: you pay by the hour and stop paying when the load stops.',
  'term.1y': 'A 1-year commitment: a lower hourly price in return for paying for a year. On AWS p5.48xlarge it is 0.63 of the on-demand price, 37% off.',
  'term.3y': 'A 3-year commitment: a lower hourly price in return for paying for three years. On AWS p5.48xlarge it is 0.43 of the on-demand price, 57% off.',
  'buyGpu': 'Which GPU to buy servers with. The page picks the cheapest server of that GPU that fits the copies of the model you need. {gpuNow} {buyNow}',
  'energy': 'The price per kWh of the electricity the servers use, {energyDefault} by default, which is the US commercial average from the US Energy Information Administration. The bill gets servers x the rated power of one server x the power usage effectiveness ({pue}) x {hoursPerMonth} hours x this price, so the page charges the full rated power for every hour of the month, whether or not the servers are busy. That is on the high side, because an idle server draws less than its rating; rack space is billed separately, in the assumptions table.',

  // API card
  'card.api': 'What the same tokens would cost on the API you picked, billed per token. The like-for-like option is the same model as yours; the Claude, OpenAI and Gemini options are different, larger models, so they compare tokens and not quality.',
  'api.title': 'The API whose prices are used for this card.',
  'api.monthly': 'The API bill for a month: requests per hour ({reqPerHour} here) x cost per request x {hours} hours a day x 30.4 days.',
  'api.perMtok': 'The same bill divided by the millions of output tokens. On an API every token costs the same, so this does not change with the number of streams.',
  'api.notes': 'Extra facts about this price, such as a change that is scheduled, a note from the price list, or a higher rate for very long prompts.',

  // Self-hosting card
  'card.self': 'What running the model on your own GPUs would cost for the same tokens, and what you would have to run to get there.',
  'self.title': 'The machine you would rent, or the server you would buy.',
  'self.monthly': 'The self-hosting bill for a month: {monthlyHow}.',
  'self.perMtok': 'The same bill divided by the millions of output tokens. It falls as more streams fill each machine, then flattens. That floor is the cheapest your own GPUs can go.',
  'self.deployment': 'What you would run. A replica is one complete copy of the model, on the smallest group of 1, 2, 4 or 8 GPUs that fits the weights and one request at the reserved window. Right now: {deployNow}.',
  'self.perReplica': "How many requests one replica serves at once while every stream still gets {v} tokens per second. Memory is reserved for the full window of every request, so a longer window means fewer requests per replica and more machines. The page's memory model is simpler than the serving engine's own and can differ by about one request per GPU: for Qwen3.8 27B on one RTX PRO 6000 at 4 bits and a 262,144-token window it says 7, while the vLLM startup log in part 4 of the series says 6.38.",
  'self.confidence': 'How far to trust the speed estimate. Calibrated means the speed constants were fitted on measured runs, and extrapolated means they were borrowed from other GPUs. Most measured runs landed inside x{bandLow} to x{bandHigh} of the estimate and some landed outside it, so read the band as typical, not as a limit.',
  'self.speedwarn': 'The speed you asked for is missed even when a replica serves one request alone, so the figure shows the cheapest case: one replica for every stream. Lower the speed per stream or pick a faster GPU.',
  'self.notes': 'Notes about this setup, such as a stream speed one GPU cannot reach, or a model size that is only an estimate. For servers you buy, one note also splits the monthly figure into hardware, electricity, rack space and support.',

  // Assumptions table
  'assumptions': 'Every number the two bills are built from, and where each one comes from. Hover or focus a row to read what it means, and its last cell for what the basis means.',
  'as.isl': 'The prompt size used for every request, cached and new input together. In Simple and in a custom split it is the context length minus the output. In an agent loop it is the average over all the turns, because the conversation grows every turn.',
  'as.osl': 'The answer size used for every request. In Simple and in a custom split it is a share of the context length, and the value in this row says which share. In an agent loop it is the output of one turn.',
  'as.ctx': 'How much memory is reserved for each request, counted in tokens. Every parallel request is assumed to grow to this full size, which is the worst case. In Detailed it is the largest context the loop reaches, capped at the model window.',
  'as.v': 'The speed each stream should get. It decides how many streams share one replica, and how long a request lasts on the API side.',
  'as.ttft': 'The wait before the first output token. Only the API side counts it: a request lasts the answer length divided by speed, plus this wait.',
  'as.kv': 'The memory a model keeps about the tokens it has already read, called the KV cache, is stored at 8 bits per number. That is the same for every model here and is not a setting.',
  'as.hours': 'The hours a day the load runs. They set the API bill and the rent bill. A bought server is billed all 24 hours.',
  'as.cached': 'The part of the input billed at the cached price, counted against the input only. In Simple and in a custom split it is the cached share of the context divided by the share that is input. In an agent loop it is worked out from the loop: everything except what the latest turn added. {apiCachedNow}',
  'as.cachewrite': 'Anthropic and OpenAI charge 1.25 times the input price for tokens written to the cache. This page does not, so for a loop that adds new context every turn the API bills are a little low and self-hosting looks a little worse than it is.',
  'as.price': 'What the provider charges for the whole machine for one hour, including any add-on charge, as published.',
  'as.term': 'How the machine is paid for: on demand, or a 1-year or 3-year commitment.',
  'as.amort': 'The number of years a server price is spread over. Company filings give 5 to 6 years for servers and none gives a life for GPUs alone, so we pick {amortYears}.',
  'as.energy': 'What electricity costs per kWh. It starts at the US commercial average and you can change it in the controls. The page charges the full power of the server for every hour of the month, times the power usage effectiveness.',
  'as.colo': "What it costs to rent rack space and power in someone else's data centre, per kW of power you reserve each month. It is billed whether or not the servers are busy, and electricity is billed on top.",
  'as.pue': 'Power usage effectiveness: how much power the whole data centre uses for each unit the servers use. At {pue}, a server drawing 1 kW costs {pue} kW on the meter.',
  'as.support': 'Yearly maintenance and repair, as a share of the server price. Nobody publishes a figure for GPU servers, so {support}% is our pick between nearly free and 12%.',
  'as.server': 'What a seller charges for one server. Most are list prices, and the small RTX PRO 6000 servers are the sum of a published chassis price and card prices.',
  'as.power': 'How much power the whole server draws at full load, in kW. It is charged for every hour of the month.',

  // What the basis column means
  'basis.set': 'A number you set in the controls.',
  'basis.loop': 'Worked out from the agent loop you described.',
  'basis.fixed': 'Fixed by how the model data is set up, not a setting.',
  'basis.notmodelled': 'Left out of the calculation on purpose.',
  'basis.worstcase': 'The calculator assumes the worst case: each request may fill the whole window.',
  'basis.simple': 'Fixed by Simple mode. Switch to Detailed to change it.',
  'basis.loopmax': 'The largest context the agent loop reaches, never more than the model window.',
  'basis.published': 'A seller or a data source states this number.',
  'basis.list': "The seller's published list price.",
  'basis.retail': "The seller's retail price.",
  'basis.quote': 'A price taken from a quote.',
  'basis.recommendation': 'Our own choice, made from the evidence. No source states it outright.',
  'basis.aggregator': 'A third party that collects or repeats this number.',
  'basis.arithmetic': 'Worked out from other numbers.',
  'basis.derived': 'Worked out from other published numbers.',
  'basis.measured': 'Read off a real measurement.',
  'basis.assumption': 'An assumption of this page.',

  // Legend
  'legend.api': 'The API bill. It is a straight line because twice the streams means twice the requests, so twice the bill.',
  'legend.self': 'Self-hosting at the expected speed. It moves in steps because you can only add whole copies of the model, and often whole machines. It is dashed when the speed you asked for is missed.',
  'legend.band': 'The accuracy band: the typical range for self-hosting if the GPUs turn out faster or slower than estimated. Most measured runs landed between x{bandLow} and x{bandHigh} of the estimated speed, and some landed outside.',
  'legend.here': 'Your setting: the number of parallel streams you chose, drawn as a solid line. The dots are the two bills at that point, the same figures as the cards above.',
  'legend.cross': 'The crossover: the number of parallel streams from which self-hosting costs less than the API at the expected speed. {crossNow}',

  // Chart elements
  'chart.api.monthly': 'The API bill at each number of streams. Twice the streams means twice the bill, so on this log chart it is a straight rising line.',
  'chart.api.monthly.linear': 'The API bill at each number of streams. Twice the streams means twice the bill, so on this linear chart it is a straight line through zero.',
  'chart.api.mtok': 'What one million output tokens costs on the API. It stays flat because every token is billed at the same price.',
  'chart.self': 'Self-hosting at the expected speed. It moves in steps because you can only add whole copies of the model, so it stays flat until one more is needed and then jumps. A dashed line means the speed you asked for is missed even with one request per GPU.',
  'chart.band': 'The accuracy band. The top edge is the slow end, where the GPUs run at x{bandLow} of the estimate, and the bottom edge is the fast end, at x{bandHigh}. Most measured runs landed in between, and some outside.',
  'chart.cross': 'The crossover: self-hosting starts costing less than the API at this number of parallel streams, at the expected speed. {crossNow}',
  'chart.axis.x': 'Parallel streams, on a log scale from 0.01: each gridline is 10 times the one before it. The right edge follows your parallel streams setting: it is 100, 1,000 or 10,000, the first of these that is at least three times your number (10,000 at most). Right now it is {xMax}.',
  'chart.axis.x.linear': 'Parallel streams, on a linear scale from 0: every gridline is the same step apart. The right edge follows your parallel streams setting: it is about three times your number, rounded up to a round figure (10,000 at most). Right now it is {xMax}.',
  'chart.axis.y.monthly': 'US dollars per month, on a log scale: each gridline is 10 times the one below it.',
  'chart.axis.y.monthly.linear': 'US dollars per month, on a linear scale from $0: every gridline is the same step apart.',
  'chart.axis.y.mtok': 'US dollars per million output tokens, on a log scale: each gridline is 10 times the one below it.',
  'chart.axis.y.mtok.linear': 'US dollars per million output tokens, on a linear scale from $0. The self-hosting curve climbs steeply at small numbers of streams, so it runs off the top of the chart there; the readout still gives the exact figure.',
  'chart.hint': 'Use the left and right arrow keys to move along the chart, or hold Shift to move ten points at a time.',
  'chart.here': 'Where your current setting sits: the number of parallel streams you chose, {C} right now. The dots are the two bills at that point, the same figures as the cards above.',
  'chart.note': 'Self-hosting is not offered for this combination, so only the API is drawn.',
};

// Replaces each {name} with facts[name]. A missing fact stays visible as
// {name} so the tests catch it.
export function tipText(key, facts = {}) {
  const raw = TIPS[key];
  if (raw === undefined) return '';
  return raw.replace(/\{(\w+)\}/g, (all, name) => (facts[name] === undefined ? all : String(facts[name]))).replace(/\s+/g, ' ').trim();
}

const BASIS_KEYS = {
  'average over the loop': 'basis.loop',
  'derived from the agent loop': 'basis.loop',
  'set in the controls': 'basis.set',
  'fixed by the model': 'basis.fixed',
  'reserved in full for every request (worst case)': 'basis.worstcase',
  'fixed in simple mode': 'basis.simple',
  'largest context the loop reaches, capped at the model window': 'basis.loopmax',
  'list price': 'basis.list',
  'retail price': 'basis.retail',
  quote: 'basis.quote',
  published: 'basis.published',
  recommendation: 'basis.recommendation',
  aggregator: 'basis.aggregator',
  arithmetic: 'basis.arithmetic',
  derived: 'basis.derived',
  measured: 'basis.measured',
};

// The tip key for the text in an assumptions row's basis cell.
export function basisKey(basis) {
  if (basis.startsWith('not modelled')) return 'basis.notmodelled';
  return BASIS_KEYS[basis] ?? 'basis.assumption';
}
