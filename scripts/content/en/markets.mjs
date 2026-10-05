/** CLUSTER: markets & data — 10 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'reading-candlestick-charts',
    cluster: 'markets',
    icon: 'chart',
    title: 'Reading Candlestick Charts Without Reading Too Much Into Them',
    description:
      'Each candle is four numbers over a time window. What the body and wicks describe, why the timeframe changes everything, and the limits of patterns.',
    h1: 'A candle is four numbers, not a prophecy',
    intro: [
      'A candlestick encodes open, high, low and close for one interval. That is all. Everything else — the names, the patterns, the psychology — is interpretation layered on top of four prices.',
      'The encoding is genuinely useful because it shows range and direction at a glance. The interpretation is where people go wrong.'
    ],
    sections: [
      ['What the shape tells you', [
        'The body spans open to close and shows net direction. The wicks reach to high and low and show how far price travelled and was rejected. A long upper wick means buyers pushed up and could not hold it; a long lower wick means the reverse.',
        'A body with almost no wicks means the interval trended cleanly. A tiny body with long wicks on both sides means a lot of movement and no resolution.'
      ]],
      ['Timeframe changes the picture completely', [
        'A one-minute chart showing a dramatic reversal is a single candle on the hourly. Neither is more true; they answer different questions. Choosing a timeframe is choosing which movements you consider noise.',
        'Reading a short timeframe and making a long-horizon decision is one of the most common errors, and it is a category error rather than a skill problem.'
      ]],
      ['Patterns and what they are worth', [
        'Named formations describe shapes that recurred often enough to get names. Some have weak statistical support in some markets; most published results do not survive transaction costs and out-of-sample testing.',
        'The honest framing is that a pattern is a description of what just happened, sometimes useful as context, never as a forecast.'
      ]],
      ['Reading a crypto chart specifically', [
        'Crypto trades continuously, so there is no session open or close to anchor daily candles — the boundary is a timezone convention. Volume differs enormously between venues, and a candle from a thin venue describes that venue, not the market.',
        'FBT Swap presents chart history and indicator readings with their window and source, and presents no formation as a signal to act.'
      ]]
    ],
    facts: [
      ['Encodes', 'Open, high, low and close for one interval'],
      ['Body', 'Net direction; wicks show rejected extremes'],
      ['Timeframe', 'Determines what counts as noise — pick it deliberately'],
      ['Patterns', 'Descriptions of the past, not predictions']
    ],
    faqs: [
      { q: 'Which timeframe is best?', a: 'The one matching your decision horizon. If you are deciding something over weeks, a five-minute chart is adding noise rather than information.' },
      { q: 'Do candlestick patterns work in crypto?', a: 'Evidence is weak and inconsistent across markets and periods, and most results fail after costs. Treating them as context rather than as signals is the defensible position.' },
      { q: 'Why do charts differ between sites?', a: 'Different venues, different aggregation and different timezone conventions for the daily boundary. A candle is always a candle of something specific, and that something varies.' }
    ]
  }),

  article({
    slug: 'trading-volume-explained',
    cluster: 'markets',
    icon: 'pulse',
    title: 'Trading Volume: What It Measures and How It Is Faked',
    description:
      'Volume is activity, not interest. Compare an asset to its own history, watch for wash trading, and know why on-chain volume differs from reported.',
    h1: 'Volume is the most abused number in crypto',
    intro: [
      'Volume counts how much changed hands over a period. It is one of the few genuinely objective measurements available on-chain, and one of the most frequently manipulated when it is reported by a venue.',
      'Using it well means knowing where the number came from and comparing it to the right baseline.'
    ],
    sections: [
      ['Compare against the asset, not the market', [
        'Ten million dollars of daily volume is enormous for a small token and negligible for a major one. The only useful comparison is an asset against its own typical range — today versus its median over a recent window.',
        'That is why a well-built market view reports volume as a multiple of normal rather than as a raw figure.'
      ]],
      ['What a volume spike actually tells you', [
        'That participation increased. It does not tell you direction, because every trade has a buyer and a seller. A large move on heavy volume reflects broad participation; the same move on thin volume reflects one impatient order against a shallow book.',
        'That distinction matters for whether a level is likely to hold, and it is about as much as volume can honestly support.',
        "Where the volume occurred matters as much as how much of it there was. The same figure concentrated in a single venue and spread evenly across twenty describes two different markets, and an aggregate that hides the split is less informative than it appears."
      ]],
      ['Wash trading and reported volume', [
        'An entity trading with itself produces real transactions and fake information. On centralised venues this has been widely documented; on-chain it is visible but still cheap on low-fee networks.',
        'Signals include volume with little price movement, round-number patterns, and volume concentrated in a handful of addresses or accounts.'
      ]],
      ['On-chain versus aggregated figures', [
        'On-chain DEX volume is verifiable — every swap is a transaction. Aggregated figures combine venues with different reliability and methodologies, so two sites can report very different numbers for the same asset on the same day.',
        'FBT Swap shows market readings with their source and compares volume to each asset\'s own median rather than an absolute threshold.'
      ]]
    ],
    facts: [
      ['Measures', 'Activity over a period, not interest or direction'],
      ['Useful baseline', "The asset's own median, not an absolute figure"],
      ['Wash trading', 'High volume, little price movement, few participants'],
      ['Most verifiable', 'On-chain DEX volume — every swap is a transaction']
    ],
    faqs: [
      { q: 'Does high volume mean a price move will continue?', a: 'No. It indicates broad participation in what already happened. Continuation is a separate question that volume alone does not answer.' },
      { q: 'Why do two sites report different volume?', a: 'Different venue coverage, different inclusion rules for self-trading, and different handling of derivatives. Neither is necessarily wrong; they are measuring different sets.' },
      { q: 'Is on-chain volume always real?', a: 'It is always a real transaction, which is not the same as a real trade. Wash trading on-chain is observable but still happens, especially where fees are low.' }
    ]
  }),

  article({
    slug: 'order-book-depth-and-liquidity',
    cluster: 'markets',
    icon: 'layers',
    title: 'Liquidity Depth: The Number That Decides Your Fill',
    description:
      'Depth is how much you can trade before the price moves. Why it matters more than volume, and how to measure it on an AMM.',
    h1: 'Depth, not volume, decides what you pay',
    intro: [
      'Volume tells you what traded yesterday. Depth tells you what you can trade right now without moving the price, and it is the number that determines your actual cost.',
      'An asset can have impressive volume and terrible depth, which is exactly the combination that produces a surprising fill.'
    ],
    sections: [
      ['Depth on an order book', [
        'The book lists resting orders at each price. Depth at a given distance from the mid price is the cumulative size available within it. A market order consumes that depth from the best price outward, so your average fill worsens as you go.',
        'A tight spread with nothing behind it looks liquid and is not — the first order consumes the whole visible size.'
      ]],
      ['Depth on an AMM', [
        'There is no book, so depth is the pool reserves and the shape of the curve. The practical equivalent is price impact: the percentage you lose by trading a given size, which is exactly what depth means in effect.',
        'Concentrated liquidity makes this price-dependent — a pool can be deep at the current price and thin a few percent away.'
      ]],
      ['Measuring it before you trade', [
        'Request a quote at your actual size and read the price impact. Then request one at double the size. The way impact scales tells you whether you are near the edge of available liquidity.',
        'This takes seconds and is more informative than any liquidity metric published elsewhere.'
      ]],
      ['Why it varies by venue and chain', [
        'Liquidity is fragmented across chains and venues, and it does not aggregate. The same pair can be deep on one network and nearly untradeable on another, and an aggregator can only route to the pools that exist where you are.',
        'FBT Swap shows the price impact for the amount you entered on the network you selected, which is the only depth measurement that matters for your specific trade.'
      ]]
    ],
    facts: [
      ['Definition', 'How much you can trade before the price moves against you'],
      ['On an AMM', 'Expressed as price impact for your specific size'],
      ['Quick test', 'Quote your size, then double it, and compare the impact'],
      ['Not transferable', 'Depth is per venue and per chain; it does not aggregate']
    ],
    faqs: [
      { q: 'Is a tight spread the same as good depth?', a: 'No. A tight spread with minimal size behind it is common and misleading. Depth is about cumulative size available within a price range, not the best quote.' },
      { q: 'How do I find the deepest venue for a pair?', a: 'Compare quotes for your actual size across the networks you can use. The best output after fees identifies the deepest effective route, which is what matters.' },
      { q: 'Does an aggregator fix thin liquidity?', a: 'It finds the best combination of what exists and can split across pools to reduce impact. It cannot create depth that is not there, so a thin pair stays expensive.' }
    ]
  }),

  article({
    slug: 'rsi-indicator-explained',
    cluster: 'markets',
    icon: 'pulse',
    title: 'RSI: What It Measures and Why It Stays Overbought',
    description:
      'Relative strength index compares average gains to average losses over a window. Why 70 and 30 are conventions, and why it fails in trends.',
    h1: 'RSI measures recent momentum, nothing more',
    intro: [
      'The relative strength index compares the average size of recent up moves to the average size of recent down moves, scaled to a range between zero and one hundred.',
      'That is a description of momentum over a chosen window. Everything attached to it — overbought, oversold, divergence — is convention, and the conventions fail in exactly the conditions people most want to use them.'
    ],
    sections: [
      ['How it is calculated', [
        'Over a lookback period, typically fourteen intervals, the average gain and average loss are computed and expressed as a ratio. A high reading means up moves have dominated recently in magnitude; a low reading means the opposite.',
        'The window is a choice. A shorter period makes it more reactive and noisier; a longer one smooths it and lags more.'
      ]],
      ['Why 70 and 30 are not rules', [
        'Those thresholds are conventions from a specific market decades ago. There is nothing in the mathematics that makes them meaningful, and different assets and timeframes behave very differently around them.',
        'In a strong trend an asset can hold above seventy for weeks. Selling the first touch is a well-documented way to exit early in exactly the moves worth holding.'
      ]],
      ['Divergence and its limits', [
        'Divergence — price making a new high while RSI does not — is the most cited use. It describes a real thing: the latest move had less momentum behind it than the previous one.',
        'It also occurs frequently in trends that continue, so as a standalone signal it produces many false readings. Context matters more than the indicator.'
      ]],
      ['Using it honestly', [
        'It is useful as a description of current conditions alongside other information: has this move been unusually one-sided relative to the recent past? That question has an answer. "Is this a top?" does not.',
        'FBT Swap shows RSI alongside other readings with its window stated and presents none of them as a trading instruction.'
      ]]
    ],
    facts: [
      ['Measures', 'Average gain versus average loss over a lookback window'],
      ['Default window', 'Fourteen intervals; shorter is noisier, longer lags'],
      ['70 and 30', 'Conventions, not rules — they fail persistently in trends'],
      ['Best use', 'Describing current conditions, not timing reversals']
    ],
    faqs: [
      { q: 'Does RSI above 70 mean sell?', a: 'No. It means recent up moves have outweighed down moves. In a strong trend this persists for extended periods, and acting on the first reading exits the move early.' },
      { q: 'What window should I use?', a: 'Fourteen is the default and the most widely watched. Shorter windows react faster and generate more false readings; there is no window that makes the indicator predictive.' },
      { q: 'Is RSI useful at all?', a: 'As one description of conditions among several, yes. As a standalone timing rule, published testing does not support it, and the honest framing is context rather than signal.' }
    ]
  }),

  article({
    slug: 'macd-indicator-explained',
    cluster: 'markets',
    icon: 'chart',
    title: 'MACD: A Difference of Averages, and What It Lags',
    description:
      'MACD subtracts a slow moving average from a fast one and smooths the result. What a crossover means and why it is always late.',
    h1: 'MACD is two averages subtracted — including the lag',
    intro: [
      'Moving average convergence divergence takes a fast exponential average, subtracts a slow one, and plots the difference along with a signal line that smooths it further.',
      'Everything it tells you is derived from past prices with deliberate smoothing, which means it is informative about what happened and structurally late about what is happening.'
    ],
    sections: [
      ['The three components', [
        'The MACD line is the fast average minus the slow one, conventionally twelve and twenty-six periods. The signal line is a nine-period average of that line. The histogram is the gap between them.',
        'When the fast average pulls away from the slow one, the line extends; when they converge, it returns toward zero.'
      ]],
      ['What a crossover indicates', [
        'The MACD line crossing its signal line means the recent rate of change has shifted relative to its own recent average. It is a statement about momentum having already turned.',
        'Because both inputs are smoothed averages, the turn happened before the crossover printed. The indicator is late by construction, and shortening the periods trades lag for false signals.'
      ]],
      ['Where it misleads', [
        'In a sideways market it crosses constantly, producing a stream of signals that each lose a little to costs. In a strong trend it can stay extended for a long time, which reads as overextension and is simply a trend.',
        'The histogram is often read as acceleration, which is reasonable, but it is an average of averages and should not be treated as precise.'
      ]],
      ['Reasonable use', [
        'As a smoothed view of whether momentum is building or fading over your chosen horizon, alongside depth, volume and the actual price level. Not as a trigger on its own.',
        'FBT Swap shows MACD among other readings with its parameters stated, and shows an unavailable state rather than an invented value when the source is down.'
      ]]
    ],
    facts: [
      ['Construction', 'Fast EMA minus slow EMA, plus a signal line average'],
      ['Conventional periods', '12, 26 and 9'],
      ['Inherent property', 'Lags by design; shortening it adds false signals'],
      ['Worst conditions', 'Sideways markets, where it crosses repeatedly']
    ],
    faqs: [
      { q: 'Is a MACD crossover a buy signal?', a: 'It is a statement that smoothed momentum has shifted. Used alone it performs poorly in ranging markets, and published testing does not support it as a standalone rule.' },
      { q: 'Should I change the default periods?', a: 'Shorter periods react faster and produce more noise; longer ones lag further. No setting removes the lag, because the lag is what the smoothing is for.' },
      { q: 'What does the histogram add?', a: 'It shows whether the two lines are converging or diverging, which reads as momentum building or fading. It is a derivative of smoothed data, so it should be read directionally rather than precisely.' }
    ]
  }),

  article({
    slug: 'moving-averages-explained',
    cluster: 'markets',
    icon: 'history',
    title: 'Moving Averages: Useful Summary, Terrible Prediction',
    description:
      'Simple and exponential averages smooth noise and lag by design. What they genuinely show, and why crossovers are not a strategy.',
    h1: 'A moving average describes, it does not forecast',
    intro: [
      'A moving average is the mean price over the last N periods, recalculated each period. An exponential one weights recent prices more heavily so it responds faster.',
      'It is the most useful simple tool on a chart and the most over-interpreted. The useful part is reducing noise; the over-interpretation is treating the line as support.'
    ],
    sections: [
      ['Simple versus exponential', [
        'A simple average weights every period equally, so an extreme value affects it identically whether it occurred yesterday or forty days ago — and it drops out abruptly when it leaves the window.',
        'An exponential average decays older values smoothly, which removes that artefact and responds faster to change. For most purposes the exponential version behaves better.'
      ]],
      ['Lag is the feature', [
        'Any average of the last N periods is by definition behind the current price. That is what makes it smooth. A shorter window reduces lag and reintroduces the noise the average existed to remove.',
        'There is no setting that gives you smooth and immediate, and searching for one is how people end up with twelve lines on a chart.',
        "Fitting the window to past data makes this worse. Any period can be tuned to look excellent on a chosen history, and the tuned value almost never performs the same afterwards. A parameter selected because it worked last year is a description of last year."
      ]],
      ['Crossovers and the honest evidence', [
        'A fast average crossing a slow one marks a change in recent trend relative to a longer one. Tested as a mechanical rule across markets and periods, results are inconsistent and usually negative after transaction costs.',
        'Widely watched levels can become briefly self-fulfilling because many participants act on them, which is a different phenomenon from predictive power.'
      ]],
      ['What they are good for', [
        'Seeing trend direction without squinting through noise, comparing current price to a recent baseline, and defining a consistent context for other measurements.',
        'FBT Swap shows moving averages alongside other readings with their periods stated, as description rather than instruction.'
      ]]
    ],
    facts: [
      ['Simple', 'Equal weighting; old values drop out abruptly'],
      ['Exponential', 'Recent prices weighted more; responds faster'],
      ['Lag', 'Unavoidable — it is the mechanism that produces smoothing'],
      ['Crossovers', 'Inconsistent as a mechanical rule, especially after costs']
    ],
    faqs: [
      { q: 'Is the 200-day average meaningful?', a: 'It is widely watched, which can make it briefly self-fulfilling as participants act around it. That is a behavioural effect rather than evidence that the level has predictive content.' },
      { q: 'Which period should I use?', a: 'One that matches your horizon. Short periods for short decisions, long for long ones. Mixing a short average with a long-horizon decision produces noise, not insight.' },
      { q: 'Do averages work as support and resistance?', a: 'Sometimes price reacts near them because many participants expect it to. Treating that as reliable is unsupported, and it fails precisely during the fast moves when it matters most.' }
    ]
  }),

  article({
    slug: 'support-and-resistance-levels',
    cluster: 'markets',
    icon: 'layers',
    title: 'Support and Resistance: Counting Touches, Not Predicting Them',
    description:
      'A level is where price repeatedly reacted. How to count touches honestly, what a held-versus-broke record means, and why it is not a forecast.',
    h1: 'Levels are a record of the past, not a floor',
    intro: [
      'A support level is a price where buying has repeatedly appeared; resistance is where selling has. Both are descriptions of what happened at a price, derived by counting.',
      'The useful question is not "will this hold" but "how often has it held before, and how many times has it been tested". One of those has an answer.'
    ],
    sections: [
      ['How a level is identified', [
        'By finding prices where the series repeatedly reversed, within a tolerance band since exact prices rarely recur. Count the touches, and record whether each one held or broke through.',
        'A level tested four times and held three is a specific, checkable fact. A line drawn through two points is not.'
      ]],
      ['Why levels exist at all', [
        'Clusters of resting orders, previous highs and lows where participants have memory, round numbers that attract attention, and liquidation thresholds where forced flow appears.',
        'These are real mechanisms and they decay. A level from two years ago has far less of this structure behind it than one from last week.'
      ]],
      ['The counting problem', [
        'With enough lines, every chart has a level near every price. The discipline is fixing the method in advance: a defined tolerance, a minimum number of touches, a defined window — then counting what the data gives you.',
        'Drawing lines after the fact to explain a move is not analysis, and it is what most published chart commentary consists of.'
      ]],
      ['The limit to state plainly', [
        'A level that held four times can break on the fifth, and nothing in the record says which time it will. The record is context for sizing and for where to place a decision, not a prediction.',
        'FBT Swap counts touches across the whole series and reports the held-versus-broke record with the window, and says on the same screen that a level can break.'
      ]]
    ],
    facts: [
      ['Identified by', 'Repeated reversals within a tolerance band'],
      ['Reported as', 'Touch count plus a held-versus-broke record'],
      ['Underlying causes', 'Resting orders, memory, round numbers, liquidation thresholds'],
      ['Limit', 'A level that held repeatedly can still break on the next test']
    ],
    faqs: [
      { q: 'Does a support level mean the price will bounce?', a: 'No. It means price has reacted there before. The record tells you how often, which is useful context; it does not tell you what happens next.' },
      { q: 'Why do levels sometimes flip roles?', a: 'Once a level breaks, participants who traded around it adjust, and resting orders accumulate on the other side. The mechanism is behavioural and is not guaranteed to occur.' },
      { q: 'How many touches make a level meaningful?', a: 'More is better, and the method must be fixed before counting. Two touches is a line through two points; the usefulness comes from a consistent rule applied to the whole series.' }
    ]
  }),

  article({
    slug: 'crypto-market-cap-explained',
    cluster: 'markets',
    icon: 'globe',
    title: 'Market Capitalisation: A Number That Is Not Money',
    description:
      'Market cap is price multiplied by circulating supply. Why it is not the amount invested, and why fully diluted valuation changes the picture.',
    h1: 'Market cap is a multiplication, not a measure of money',
    intro: [
      'Market capitalisation is the last traded price multiplied by circulating supply. It is widely used for ranking and widely misread as the amount of money in an asset.',
      'It is not. The last price reflects the marginal trade, and multiplying it by every unit in existence assumes all of them could be sold at that price, which is never true.'
    ],
    sections: [
      ['What the multiplication assumes', [
        'That the price of the last small trade applies to the entire supply. For a liquid asset the error is modest; for a thin one it is enormous, because selling even a fraction of the supply would move the price dramatically.',
        'This is why a token can have a large headline capitalisation and almost no depth. The two numbers are unrelated.'
      ]],
      ['Circulating versus total versus fully diluted', [
        'Circulating supply excludes locked, vested and unissued tokens. Total supply counts everything issued. Fully diluted valuation uses maximum supply, which includes tokens that do not yet exist.',
        'A low circulating supply with a large future unlock schedule means the current capitalisation understates future dilution, and that schedule is public information worth reading.'
      ]],
      ['Why rankings mislead', [
        'Two assets with the same capitalisation can differ by orders of magnitude in liquidity, holder distribution and how much of the supply is genuinely tradeable. Ranking by capitalisation treats them as comparable.',
        'A better quick comparison is depth at your size, plus the unlock schedule.',
        "Burned supply complicates it further. Tokens sent to an unspendable address are gone in practice but may still be counted depending on the methodology, which is one reason the same asset can rank differently on two sites without either of them making an error."
      ]],
      ['Using it for what it is good at', [
        'Rough scale comparison between established assets, and tracking how an asset\'s relative position changes over time. Not for estimating how much could be realised, and not for judging whether something is cheap.',
        'FBT Swap shows market data with its source and never presents a valuation as a judgement about value.'
      ]]
    ],
    facts: [
      ['Formula', 'Last price multiplied by circulating supply'],
      ['Assumes', 'That every unit could trade at the latest marginal price'],
      ['Fully diluted', 'Uses maximum supply, including unissued tokens'],
      ['Better question', 'Depth at your size, and what unlocks when']
    ],
    faqs: [
      { q: 'Does market cap show how much money entered an asset?', a: 'No. A small amount of buying in a thin market can create a very large capitalisation, because the multiplication applies the marginal price to the entire supply.' },
      { q: 'Is a low market cap a sign of opportunity?', a: 'It indicates scale, not value. Many low-capitalisation assets are small because of limited demand, and the same thinness that allows rapid rises allows rapid falls.' },
      { q: 'Why do sites report different figures?', a: 'Mainly different definitions of circulating supply — which locked, team-held or burned tokens are excluded. The methodology is usually published and is worth checking.' }
    ]
  }),

  article({
    slug: 'funding-rates-explained',
    cluster: 'markets',
    icon: 'receipt',
    title: 'Funding Rates: How Perpetual Futures Track Spot',
    description:
      'Perpetuals have no expiry, so periodic payments between longs and shorts pull the price toward spot. What the rate signals and what it costs.',
    h1: 'The payment that keeps a perpetual anchored',
    intro: [
      'A perpetual futures contract never expires, so there is no settlement date forcing its price to converge with spot. Funding is the mechanism that replaces it.',
      'At regular intervals, one side pays the other. When the perpetual trades above spot, longs pay shorts, which makes being long more expensive and pulls the price back down.'
    ],
    sections: [
      ['How the rate is set', [
        'The rate is derived from the premium of the perpetual over an index of spot prices, plus an interest component. A large premium produces a large payment, which creates an incentive to take the other side.',
        'Payments are periodic — commonly every eight hours — and are exchanged between traders, not paid to the venue.'
      ]],
      ['What a persistently high rate means', [
        'That positioning is crowded on one side. Sustained high positive funding means many leveraged longs are paying to keep their positions, which is a real cost that compounds and a sign of one-sided exposure.',
        'It is frequently described as a contrarian signal. It genuinely describes positioning; it does not reliably time anything.'
      ]],
      ['The cost to a position holder', [
        'An annualised funding cost can be substantial and is easy to underestimate because it is charged in small increments. A position held through weeks of elevated funding can lose meaningfully even if the price is flat.',
        'For hedging, this is the carry cost. For directional positions, it is a drag that must be covered before any profit.',
        "Rates also differ between venues for the same asset, sometimes substantially. That spread is itself tradeable and is part of why professional flow exists in these markets, but for an ordinary position it mainly means the cost you pay depends on where you happened to open it."
      ]],
      ['Reading it alongside everything else', [
        'Funding is most informative in combination with open interest and price. Rising price with rising open interest and rising funding is a specific configuration; the same price move with falling open interest is a different one.',
        'FBT Swap surfaces derivatives data with its source where available and presents no reading as a recommendation to open a position.'
      ]]
    ],
    facts: [
      ['Purpose', 'Keeps a non-expiring contract anchored to spot'],
      ['Direction', 'Trading above spot means longs pay shorts'],
      ['Paid to', 'The other side of the trade, not the venue'],
      ['Cost', 'Compounds over time; significant for positions held for weeks']
    ],
    faqs: [
      { q: 'Is high funding a reliable reversal signal?', a: 'It reliably describes crowded positioning. As a timing tool it is unreliable, because crowded positioning can persist for a long time and become more crowded.' },
      { q: 'Do I pay funding on a spot position?', a: 'No. Funding applies only to perpetual futures. Spot holdings have no periodic payment of this kind.' },
      { q: 'Can funding be negative?', a: 'Yes. When the perpetual trades below spot, shorts pay longs. Persistent negative funding indicates crowded short positioning.' }
    ]
  }),

  article({
    slug: 'on-chain-data-for-traders',
    cluster: 'markets',
    icon: 'network',
    title: 'On-Chain Data: What It Can Honestly Tell You',
    description:
      'Exchange flows, holder concentration, active addresses and smart-money labels. Which are verifiable, which are inferred, and the limits of both.',
    h1: 'On-chain data is verifiable and frequently over-read',
    intro: [
      'Blockchain data has a property no traditional market data has: every transaction is public and verifiable. That makes it genuinely valuable and creates a temptation to read intent into it.',
      'The distinction worth holding is between what is directly observable and what is inferred from labels and heuristics.'
    ],
    sections: [
      ['Directly observable', [
        'Transfers, balances, contract interactions, token supply, liquidity pool reserves and the full history of every address. These are facts, verifiable by anyone running a node.',
        'Derived measurements like active addresses, transaction counts and realised supply distribution are also computable directly from the chain.'
      ]],
      ['Inferred, and therefore uncertain', [
        'Which addresses belong to exchanges, which belong to one entity, and which represent "smart money". These come from clustering heuristics and manual labelling, both of which are incomplete and go stale.',
        'A flow labelled as an exchange deposit may be an internal transfer, a custody migration, or a mislabel. Treating a labelled aggregate as a fact is where most on-chain analysis fails.',
        "Label quality also degrades silently. An exchange moves to new addresses, a cluster splits, a tagged wallet changes hands, and the dashboard keeps reporting against the old mapping until somebody notices. There is rarely a changelog telling you when a label stopped being true."
      ]],
      ['What exchange flows actually indicate', [
        'Coins moving to exchange addresses is commonly read as intent to sell. Often it is, and often it is collateral movement, market-making inventory, or an internal reshuffle.',
        'The signal is weak at short horizons and somewhat more informative in sustained aggregate trends, which is a much more modest claim than it is usually given.'
      ]],
      ['Using it without fooling yourself', [
        'Prefer directly observable measurements. Treat labels as hypotheses. Compare against the asset\'s own history rather than absolute thresholds. And distinguish between describing what happened and asserting why.',
        'FBT Swap presents on-chain and market readings with their source and window, and does not convert them into buy or sell instructions.'
      ]]
    ],
    facts: [
      ['Verifiable', 'Transfers, balances, reserves, supply, contract calls'],
      ['Inferred', 'Entity labels, exchange attribution, "smart money" tags'],
      ['Exchange flows', 'Weak at short horizons; sometimes informative in aggregate trends'],
      ['Discipline', "Compare to the asset's own history, not absolute thresholds"]
    ],
    faqs: [
      { q: 'Can I see what large holders are doing?', a: 'You can see what addresses are doing. Attributing those addresses to a person or firm is inference, and the attribution is often wrong or outdated.' },
      { q: 'Are exchange outflows bullish?', a: 'They are frequently described that way. The relationship is weak and noisy, and large flows regularly reflect custody or operational movements rather than trading intent.' },
      { q: 'Is on-chain analysis predictive?', a: 'It is descriptive and verifiable. Predictive claims built on it rely on labels and historical relationships that are unstable, so they should be treated with the same scepticism as any other forecast.' }
    ]
  })
];
