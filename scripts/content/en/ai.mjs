/** CLUSTER: AI & automation — 8 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'ai-in-crypto-trading-reality-check',
    cluster: 'ai',
    icon: 'sparkle',
    title: 'AI in Crypto Trading: What It Can and Cannot Do',
    description:
      'Models are good at summarising, classifying and monitoring. They are not good at predicting prices. Where the honest line sits.',
    h1: 'The useful half of AI in crypto, and the marketed half',
    intro: [
      'Almost every crypto interface now advertises AI. Some of it is genuinely useful work on data that was previously tedious to process. Some of it is a language model asked to predict a price, which is not a capability it has.',
      'The distinction is not subtle, and knowing it saves money.'
    ],
    sections: [
      ['What models are genuinely good at', [
        'Summarising long documents, extracting structure from unstructured text, classifying contract code against known patterns, translating, and flagging anomalies against a defined baseline. These are pattern tasks with verifiable outputs.',
        'Applied to crypto, that means reading contract source for known risky patterns, summarising governance proposals, and monitoring conditions continuously without fatigue.'
      ]],
      ['What they cannot do', [
        'Predict prices. Markets are adversarial, partly reflexive, and dominated by information that does not exist yet. No model has access to tomorrow\'s news, and any edge discovered in public data is competed away quickly.',
        'A model asked for a forecast will produce one, fluently and confidently, because producing fluent text is what it does. Fluency is not evidence.'
      ]],
      ['Where the failure modes are', [
        'Confident fabrication of specifics — contract addresses, numbers, events. Stale training data presented as current. And the deeper issue that a model optimised for plausible output has no internal signal distinguishing what it knows from what it is generating.',
        'This is why anything consequential must be traceable to a named source that you can check.'
      ]],
      ['The standard worth demanding', [
        'Every AI-derived claim should carry its source and its window. Unavailable data should display as unavailable rather than being filled in. And no output should be framed as a prediction or a recommendation.',
        'FBT Swap uses automated analysis to summarise market readings and surface anomalies, always with the source named. It does not forecast prices, does not recommend trades, and shows an unavailable state rather than an invented number.'
      ]]
    ],
    facts: [
      ['Good at', 'Summarising, classifying, extracting, monitoring continuously'],
      ['Bad at', 'Price prediction — no model has tomorrow\'s information'],
      ['Main failure', 'Confident fabrication of specifics like addresses and figures'],
      ['Standard', 'Named source, stated window, unavailable shown as unavailable']
    ],
    faqs: [
      { q: 'Can an AI predict crypto prices?', a: 'No. Markets are adversarial and driven substantially by information that does not yet exist. A model will produce a confident forecast because fluent text is what it generates, not because it knows.' },
      { q: 'Are AI trading bots worth using?', a: 'A bot executes rules. If the rules are sound it enforces discipline; if they are not, it loses money faster. The AI label does not change whether the underlying rules have any edge.' },
      { q: 'How should I use AI in crypto then?', a: 'For reading and summarising — contract code, documentation, governance proposals — and for continuous monitoring against defined conditions. Verify anything consequential against the primary source.' }
    ]
  }),

  article({
    slug: 'ai-contract-risk-scanning',
    cluster: 'ai',
    icon: 'shield',
    title: 'Automated Contract Scanning: Useful Screen, Not an Audit',
    description:
      'Scanners match code against known risky patterns in seconds. What they reliably catch, what they miss, and why a clean result proves little.',
    h1: 'A scanner catches known patterns, not novel logic',
    intro: [
      'Automated contract analysis reads verified source or bytecode and checks it against a library of patterns associated with risk. It takes seconds and costs nothing, which makes it a genuinely good first screen.',
      'It is also not an audit, and the gap between the two is where most losses happen.'
    ],
    sections: [
      ['What scanners reliably detect', [
        'Unrestricted mint functions, blacklist and whitelist mechanisms, transfer-blocking logic, owner-only functions that change fees or pause transfers, proxy upgradeability, and hard-coded privileged addresses.',
        'These are structural and visible in the code, which is why detection is accurate when the source is verified.'
      ]],
      ['What they miss', [
        'Novel logic that does not match a known pattern. Economic exploits where every function is individually correct but the combination is not. Off-chain dependencies such as an oracle or an admin key. And anything in an unverified contract, where only bytecode is available.',
        'Most large protocol losses have come from this category, not from patterns a scanner would flag.'
      ]],
      ['Why a clean result is weak evidence', [
        'It means no known pattern matched. Given that the most damaging exploits were novel at the time, absence of known patterns is a weak statement about safety.',
        'The asymmetry matters: a flag is strong evidence of risk, a clean result is weak evidence of safety. Treat the two very differently.',
        "False positives cut the other way. Scanners flag patterns that are legitimate in context, such as a pause function in a protocol with a published emergency process, so a flag is a prompt to read rather than a verdict. Understanding what was flagged beats counting how many flags there were."
      ]],
      ['Using it sensibly', [
        'As a cheap filter to eliminate obvious problems before spending attention. Then look at the things a scanner cannot see: who holds admin keys, whether the contract is upgradeable, how long it has held value, and whether a named firm audited it.',
        'FBT Swap does not audit arbitrary imported token contracts and does not claim to. It shows the route, price impact and fee before you sign; verification of a token you selected by address remains yours.'
      ]]
    ],
    facts: [
      ['Detects', 'Mint, blacklist, pause, fee-change and upgrade patterns'],
      ['Misses', 'Novel logic, economic exploits, off-chain dependencies'],
      ['A flag', 'Strong evidence of risk'],
      ['A clean result', 'Weak evidence of safety — only that nothing known matched']
    ],
    faqs: [
      { q: 'Is a scanner as good as an audit?', a: 'No. An audit involves humans reasoning about intent, economics and composition over weeks. A scanner matches patterns in seconds. They answer different questions at vastly different depth.' },
      { q: 'What if the contract is unverified?', a: 'Then source is unavailable and only bytecode analysis is possible, which is far less reliable. For a token asking for your money, unverified source is itself a reason to decline.' },
      { q: 'Does a clean scan mean I can buy safely?', a: 'No. It means no known risky pattern was found. Liquidity can still be pulled, admin keys can still exist, and novel logic is exactly what scanners do not catch.' }
    ]
  }),

  article({
    slug: 'automated-price-alerts',
    cluster: 'ai',
    icon: 'bell',
    title: 'Price Alerts: Useful Monitoring With an Honest Limit',
    description:
      'Alerts solve the attention problem, not the execution problem. How to set thresholds that are not noise, and what an alert cannot do.',
    h1: 'An alert tells you something happened — it does not act',
    intro: [
      'Watching a market continuously is not possible and not useful. An alert replaces watching with a condition that fires when it is met, which is a genuine improvement in how you spend attention.',
      'It is also the limit. An alert notifies. It does not place an order, and anyone implying otherwise is selling something.'
    ],
    sections: [
      ['Setting thresholds that mean something', [
        'A threshold should correspond to a decision you have already made. "Notify me if this drops twelve percent" is useful if twelve percent changes what you do; otherwise it is noise you will learn to ignore.',
        'Percentage moves relative to recent volatility are generally more informative than fixed prices, because a three percent move means different things for different assets.'
      ]],
      ['Alert fatigue is the real failure', [
        'Too many alerts produce the same outcome as no alerts: they are dismissed without reading. A small number of alerts tied to real decisions outperforms a dashboard of notifications.',
        'If an alert fires and you do nothing, either the threshold is wrong or the alert should not exist.'
      ]],
      ['What alerts genuinely cover', [
        'Price thresholds, unusual volume relative to an asset\'s own median, approach to a level with a known touch history, and conditions on assets you hold. These are all checkable continuously and cheaply.',
        'Delivery matters: an alert that arrives through a channel you do not check is not an alert.',
        "Conditions should also be able to expire. An alert set during one market regime and left running for six months fires on a threshold that no longer means anything, and by the time it arrives you have usually forgotten why you set it in the first place."
      ]],
      ['The limitation stated plainly', [
        'An alert never fills an order. If the price moves while you are asleep, you receive a notification about something that already happened and may have reversed before you read it.',
        'FBT Swap can monitor conditions and notify you. It cannot execute an unattended trade, because every swap requires your wallet signature — alerts never fill unattended.'
      ]]
    ],
    facts: [
      ['Solves', 'The attention problem — you stop watching continuously'],
      ['Does not solve', 'Execution; an alert never places an order'],
      ['Good threshold', 'Tied to a decision you have already made'],
      ['Main failure', 'Fatigue from too many alerts that change nothing']
    ],
    faqs: [
      { q: 'Can an alert buy for me automatically?', a: 'Not on a non-custodial interface. Every swap requires a wallet signature, so an alert notifies you and you decide. Automatic execution would require giving custody or signing authority to a third party.' },
      { q: 'How many alerts should I have?', a: 'Few enough that each one still gets read. If alerts fire regularly and you take no action, they have become background noise and the thresholds need rethinking.' },
      { q: 'Should I alert on price or percentage?', a: 'Percentage relative to the asset\'s recent volatility is usually more informative, because it adapts to how much the asset normally moves rather than assuming a fixed number is significant.' }
    ]
  }),

  article({
    slug: 'ai-market-summaries',
    cluster: 'ai',
    icon: 'chart',
    title: 'AI Market Summaries: Compression With Sources Attached',
    description:
      'Turning many readings into a few sentences is a real capability. It is only trustworthy when every figure traces to a named source.',
    h1: 'Summarising is the honest use of a language model here',
    intro: [
      'A market view may contain dozens of numbers across price, volume, depth, indicators and on-chain measurements. Reading all of them every time is impractical, and most of them are unremarkable most of the time.',
      'Compressing that into a few sentences that name what is unusual is a task models do well — provided every number is real.'
    ],
    sections: [
      ['What a good summary does', [
        'States what is unusual relative to the asset\'s own recent history, names the window, and attributes each figure to its source. "Volume is three times its thirty-day median" is checkable; "volume is surging" is not.',
        'It also says when nothing is unusual, which is the most common honest answer and the one marketing-driven summaries never give.'
      ]],
      ['The fabrication risk', [
        'A model generating text about markets will produce plausible numbers whether or not it has them. This is the central failure mode and it is invisible at a glance, because fabricated figures look exactly like real ones.',
        'The only defence is architectural: the model summarises data passed to it and is not permitted to supply figures of its own.'
      ]],
      ['Why sources and windows matter', [
        'A figure without a window is not a measurement. "Up fifteen percent" over an hour, a day and a month are three different statements, and the one chosen is usually the most dramatic.',
        'Naming the source lets you check it, and it reveals when two sources disagree — which happens often and is itself informative.'
      ]],
      ['What a summary cannot become', [
        'A recommendation. Describing conditions and advising action are different acts, and sliding from one to the other is what turns a useful tool into a liability for the person reading it.',
        'FBT Swap generates market summaries from data with the source and window named, states when nothing unusual is present, shows an unavailable state rather than inventing a number, and never converts a summary into a buy or sell instruction.'
      ]]
    ],
    facts: [
      ['Good summary', 'Names what is unusual, with window and source'],
      ['Honest default', '"Nothing unusual" — the most common true answer'],
      ['Central risk', 'Fabricated figures that look identical to real ones'],
      ['Hard line', 'Describing conditions is not recommending action']
    ],
    faqs: [
      { q: 'Can I trust numbers in an AI summary?', a: 'Only if they are attributed to a named source you can check. A model asked about markets will generate plausible figures regardless of whether it has data, and they are indistinguishable by appearance.' },
      { q: 'Why does a summary sometimes say nothing is happening?', a: 'Because that is usually true. A summary that always finds something significant is manufacturing significance, which makes it useless when something real occurs.' },
      { q: 'Should a summary tell me what to do?', a: 'No. Describing conditions and recommending action are different things. Nothing in a market summary constitutes financial advice.' }
    ]
  }),

  article({
    slug: 'ai-search-and-crypto-information',
    cluster: 'ai',
    icon: 'search',
    title: 'Asking AI Search About Crypto: Where It Breaks',
    description:
      'Answer engines are good at explaining concepts and unreliable for current data, addresses and anything that changed recently.',
    h1: 'What to ask an answer engine, and what to verify yourself',
    intro: [
      'People increasingly ask an AI assistant rather than searching. For crypto this works well for some questions and fails badly for others, and the failure is quiet rather than obvious.',
      'The split follows how stable the information is.'
    ],
    sections: [
      ['Stable concepts are well handled', [
        'How an AMM works, what slippage is, why approvals exist, how a rollup differs from a sidechain. These have been explained thousands of times, the explanations are consistent, and a model reproduces them reliably.',
        'For learning mechanics, this is now a genuinely good tool and often better than a search results page.'
      ]],
      ['Current data is not', [
        'Prices, fees, yields, liquidity and anything else that changes hourly. A model either has stale training data or retrieved a page of unknown freshness. Neither is a live reading.',
        'The answer will be stated with the same confidence either way, which is the problem.'
      ]],
      ['Addresses and specifics are dangerous', [
        'Contract addresses, token mints and URLs are exactly the kind of specific string a model can fabricate convincingly. Acting on a generated address can send funds to a contract that is not what you were told.',
        "The same applies to links. A fabricated domain that looks plausible is indistinguishable from a real one inside a sentence, and typing it into a browser is exactly how a phishing site acquires traffic. Navigate from a source you already trust instead of from generated text.",
        'Never use an address from an AI answer. Get it from the project\'s own documentation or a major explorer, and verify it on-chain.'
      ]],
      ['Recent events lag', [
        'Protocol changes, exploits, migrations and deprecations may not be reflected. An assistant can confidently describe a system as it existed before a significant change.',
        'FBT Swap publishes documentation designed to be read and cited by answer engines, with the mechanics stated plainly and the limits stated alongside them. The official domain is fbtswap.ir and the only contact address is fbtswap@gmail.com — anything else claiming to be FBT Swap is not.'
      ]]
    ],
    facts: [
      ['Reliable for', 'Stable concepts and mechanics'],
      ['Unreliable for', 'Prices, fees, yields and anything live'],
      ['Never use from AI', 'Contract addresses, token mints, URLs'],
      ['Lags on', 'Protocol changes, exploits, migrations']
    ],
    faqs: [
      { q: 'Can I ask an AI for the current price?', a: 'You can, and you may get a stale figure presented confidently. For anything live, read it from a source that timestamps its data.' },
      { q: 'Why would an AI give a wrong contract address?', a: 'Because generating a plausible string is what the model does, and an address is a string. It has no mechanism to know whether a specific address is correct unless it retrieved it from a reliable page.' },
      { q: 'Is AI search useful for crypto at all?', a: 'Yes, for understanding how things work. Treat conceptual explanations as useful and anything specific, current or address-shaped as something to verify at the primary source.' }
    ]
  }),

  article({
    slug: 'smart-money-tracking-explained',
    cluster: 'ai',
    icon: 'network',
    title: 'Smart Money Tracking: Labels Built on Inference',
    description:
      'Following profitable wallets sounds rigorous. The labels are heuristics, the delay is structural, and survivorship bias does the rest.',
    h1: 'Following wallets you cannot actually identify',
    intro: [
      'Smart money tracking identifies addresses with strong historical returns and reports what they are buying. The data underneath is real and public, which gives the whole thing an air of rigour.',
      'The labels on top are inference, and three structural problems limit how much the output is worth.'
    ],
    sections: [
      ['The label is a guess', [
        'Addresses are pseudonymous. Clustering heuristics group them into entities, and manual labelling attaches names. Both are incomplete, both go stale, and a sophisticated participant can trivially use fresh addresses.',
        'So "smart money bought" means "addresses previously classified as profitable, by a method of unknown accuracy, transacted".'
      ]],
      ['Survivorship bias', [
        'Selecting addresses by past profitability guarantees you are looking at winners, including those who were simply lucky. Across millions of addresses, extraordinary records occur by chance.',
        'Testing whether those addresses continue to outperform after selection is the question that matters, and it is rarely published.'
      ]],
      ['You are always late', [
        'The transaction must occur, be indexed, be classified and be displayed before you see it. The price has already moved, and the position you are copying was entered at a price you cannot get.',
        'For a large position accumulated over time, you see the end of the accumulation, not the beginning.',
        "There is also a selection effect in what gets displayed. Trackers surface the positions that moved, which means you see concentrated bets and not the diversified book they sit inside. A position that is two percent of someone’s portfolio reads, on a tracker, like conviction."
      ]],
      ['The one genuinely useful version', [
        'Not "what are they buying" but "is this specific token held by addresses with long histories, or only by addresses created last week". That is a concentration and age question, computed from observable data, and it is informative about a token\'s holder base.',
        'FBT Swap presents on-chain readings with their source and does not convert wallet labels into trade recommendations.'
      ]]
    ],
    facts: [
      ['Underlying data', 'Real and public — transfers and balances'],
      ['Labels', 'Heuristic clustering plus manual tagging, often stale'],
      ['Selection bias', 'Choosing by past profit guarantees you see winners'],
      ['Timing', 'Structurally late by indexing and classification delay']
    ],
    faqs: [
      { q: 'Does copying profitable wallets work?', a: 'Published evidence is weak. You are selecting on past returns, which includes luck, and you act after the move with worse pricing. The approach has a structural disadvantage built in.' },
      { q: 'How accurate are entity labels?', a: 'Variable and unaudited. They come from clustering heuristics and manual tagging, and sophisticated participants can defeat them with new addresses at no cost.' },
      { q: 'What is on-chain data genuinely good for here?', a: 'Describing a token\'s holder base — concentration, address age, how long holders have held. Those are computed from observable data and do not depend on guessing who anyone is.' }
    ]
  }),

  article({
    slug: 'automation-risks-in-defi',
    cluster: 'ai',
    icon: 'alert',
    title: 'Automation in DeFi: What You Hand Over to Get It',
    description:
      'Bots and keepers need permission to act. Approvals, session keys and delegated signing each create exposure that persists after you stop watching.',
    h1: 'Automation requires authority, and authority persists',
    intro: [
      'Anything that acts without you present needs permission to move your funds. That permission is the real cost of automation, and it is usually described in the interface as a convenience step.',
      'The permission does not expire when your interest does.'
    ],
    sections: [
      ['The forms permission takes', [
        'An unlimited token approval to a contract that can then transfer that token at any time. A session key with scoped authority for a period. A delegated signer on a smart contract wallet. Or full custody, where you send funds to a service.',
        'These differ enormously in exposure, and interfaces present them with similar friction.'
      ]],
      ['What goes wrong', [
        'The contract holding the permission is exploited. The operator behind it acts against you. The strategy encounters conditions its authors did not anticipate and executes faithfully into a loss. Or you forget the permission exists and it is used years later.',
        'All four have happened repeatedly, and the last is the most avoidable.',
        "Permissions also outlive the interface that requested them. A front end shutting down revokes nothing; the approval sits on-chain against a contract nobody maintains. Abandoned protocols are a standing liability for everyone who ever used them and never cleaned up afterwards."
      ]],
      ['Scoping it down', [
        'Prefer approvals limited to the amount needed. Prefer session keys with an expiry over open-ended delegation. Prefer non-custodial designs where the contract can act on your position but cannot withdraw to an arbitrary address.',
        'Review and revoke what you no longer use. A permission granted for a strategy you abandoned is pure unhedged exposure.'
      ]],
      ['The trade-off stated honestly', [
        'Automation genuinely helps with things humans do badly — reacting at three in the morning, rebalancing consistently, topping up collateral before liquidation. Those are real benefits and sometimes worth real exposure.',
        'FBT Swap is non-custodial and executes nothing without your signature. That means no automated execution and no standing authority over your funds; the trade-off is explicit rather than hidden.'
      ]]
    ],
    facts: [
      ['Required', 'Standing permission to move funds without you present'],
      ['Forms', 'Unlimited approvals, session keys, delegated signers, custody'],
      ['Persists', 'Until revoked — not until you lose interest'],
      ['Mitigation', 'Scope to amount, prefer expiry, review and revoke regularly']
    ],
    faqs: [
      { q: 'Is a keeper bot custodial?', a: 'It depends on the design. Some can only act on your position within defined bounds; others can withdraw to arbitrary addresses. Which one you are using is worth establishing before granting anything.' },
      { q: 'Can I automate without approvals?', a: 'Not meaningfully. Acting on your behalf requires authority over your funds in some form. Limiting scope and duration is realistic; eliminating the requirement is not.' },
      { q: 'Does FBT Swap run automated strategies?', a: 'No. It is non-custodial and every swap requires your wallet signature, so there is no standing authority and no unattended execution. Alerts notify; they never fill.' }
    ]
  }),

  article({
    slug: 'intent-based-trading-explained',
    cluster: 'ai',
    icon: 'sparkle',
    title: 'Intent-Based Trading: Stating Outcomes Instead of Steps',
    description:
      'You specify the result you want and solvers compete to deliver it. What the model improves, and the trust assumptions it introduces.',
    h1: 'Declaring what you want rather than how to get it',
    intro: [
      'Conventional on-chain trading is imperative: you choose a route, a venue and parameters, and you submit a transaction that does exactly that. Intent-based trading inverts it.',
      'You sign a statement of the outcome you will accept — this much of token A for at least this much of token B, by this time — and specialised parties compete to fulfil it.'
    ],
    sections: [
      ['How fulfilment works', [
        'Solvers receive your signed intent and search for a way to satisfy it: existing liquidity, their own inventory, matching against another user\'s opposite intent, or a combination. They keep any surplus beyond what you specified, which is their incentive.',
        'Because you signed a minimum outcome rather than a path, any route that clears it is acceptable to you.'
      ]],
      ['The genuine improvements', [
        'Direct matching between opposing intents avoids pool fees and price impact entirely. Batch settlement can give several users a uniform price. And specifying a minimum outcome makes certain MEV extraction unprofitable, because the surplus a sandwich would capture is bounded by what you accepted.',
        'For some order types these are real gains rather than repackaging.'
      ]],
      ['The trust you take on', [
        'Solvers are a smaller set than the open market and may be permissioned. Competition among them determines whether you get a good price or merely an acceptable one, and you cannot observe their search.',
        'The settlement contract becomes a critical dependency, and some designs rely on off-chain infrastructure whose liveness is not guaranteed.'
      ]],
      ['When it fits', [
        'Larger orders where price impact dominates, pairs where matching against opposite flow is plausible, and anyone who would rather specify a floor than manage slippage. Small swaps in deep pools gain little.',
        'FBT Swap uses an intent-style flow for supported routes: you set the outcome you will accept, the quote and the 0.70% platform fee are shown before signing, and nothing executes without your signature.'
      ]]
    ],
    facts: [
      ['You sign', 'A minimum acceptable outcome, not a route'],
      ['Solvers earn', 'Any surplus beyond what you specified'],
      ['Real gain', 'Direct matching avoids pool fees and price impact'],
      ['Trust added', 'A solver set you cannot observe, plus settlement infrastructure']
    ],
    faqs: [
      { q: 'How is this different from a limit order?', a: 'A limit order rests at a price on a specific venue. An intent is a signed outcome that any solver can satisfy by any means, including matching you directly against another user.' },
      { q: 'Does it eliminate MEV?', a: 'It bounds what can be extracted, because you signed a floor. It does not eliminate extraction — solvers capture surplus by design, and that surplus is value that could have been yours.' },
      { q: 'What if no solver fills my intent?', a: 'It expires unfilled and nothing happens. You keep your funds; you did not get the trade. That is the normal outcome when the outcome you specified is better than the market can supply.' }
    ]
  })
];
