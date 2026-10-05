/** CLUSTER: fees & gas — 10 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'crypto-gas-fees-explained',
    cluster: 'fees',
    icon: 'pulse',
    title: 'Gas Fees Explained: What You Are Paying the Network For',
    description:
      'Gas measures computation, not value. Why a swap costs more than a transfer, who receives the fee, and why it has nothing to do with the amount you send.',
    h1: 'Gas is a price for computation, not for value moved',
    intro: [
      'The most persistent misunderstanding in crypto is that network fees scale with the amount you send. They do not. Sending ten dollars and sending ten million dollars cost the same, because the network is charging for work, not for worth.',
      'Gas is the unit of that work. Every operation a transaction performs has a fixed gas cost, and the total is multiplied by a price per unit that moves with demand for block space.'
    ],
    sections: [
      ['Gas used versus gas price', [
        'Gas used is determined by what your transaction does. A simple native transfer is the cheapest possible operation. A token transfer writes to a contract and costs several times more. A multi-hop swap touches several contracts and costs more again.',
        'Gas price is what you pay per unit, set by competition for inclusion. The fee you pay is these two multiplied, which is why the same swap can cost wildly different amounts at different hours on the same network.'
      ]],
      ['Who actually receives it', [
        'The fee goes to the validators or sequencers producing blocks, and on networks with a fee-burn mechanism part of it is destroyed rather than paid to anyone. None of it reaches the interface you used.',
        'This matters when a swap fails. The computation happened, so the fee is owed, and no front end can refund it because no front end ever received it.'
      ]],
      ['Why you need the right coin', [
        'Gas is paid in the native coin of the chain: ETH on Ethereum and most rollups, BNB on BNB Chain, POL on Polygon, AVAX on Avalanche, S on Sonic, MNT on Mantle, BERA on Berachain, MON on Monad, SOL on Solana.',
        'A wallet holding a thousand dollars of USDT and no native coin cannot move anything. This is the most common reason a first transaction on a new network simply will not submit.'
      ]],
      ['Estimating before you sign', [
        'A wallet estimates by simulating the transaction and adding a margin. The estimate can be wrong if the chain state changes between simulation and inclusion, which is why a gas limit exists as a ceiling.',
        'FBT Swap shows the network and the route before signing, and your wallet shows the gas estimate in its own prompt. Both are worth reading — the platform fee of 0.70% is separate and is never taken from gas.'
      ]]
    ],
    facts: [
      ['What it prices', 'Computation and storage, not the value transferred'],
      ['Who receives it', 'Validators, sequencers and (on some chains) a burn — never the interface'],
      ['Paid in', "The chain's own native coin"],
      ['On failure', 'Still charged; the work was performed before the revert']
    ],
    faqs: [
      { q: 'Why did my small transfer cost more than a large one?', a: 'Because cost follows the operations performed and the fee market at that moment, not the amount. A token transfer during congestion can easily cost more than a native transfer during a quiet block.' },
      { q: 'Can I pay gas in a stablecoin?', a: 'Not natively on the chains supported here. Some wallets and account-abstraction setups offer a paymaster that sponsors gas and bills you in another token, but the chain itself is still paid in its native coin.' },
      { q: 'Does the 0.70% platform fee include gas?', a: 'No. They are separate and go to different places. Gas goes to the network; the platform fee is shown in the quote before you sign and is charged on the input amount of supported swap routes.' }
    ]
  }),

  article({
    slug: 'eip-1559-base-fee-and-tip',
    cluster: 'fees',
    icon: 'layers',
    title: 'Base Fee and Priority Tip: How EIP-1559 Pricing Works',
    description:
      'Ethereum splits the fee into a burned base fee and a tip to the validator. What each does, why max fee is a ceiling, and how refunds happen.',
    h1: 'Base fee, priority tip and the ceiling you set',
    intro: [
      'Before 2021, Ethereum fees were a blind auction and everybody overbid. The current model replaces most of that guesswork with a protocol-set base fee that adjusts itself block by block.',
      'Understanding the three numbers in your wallet — base fee, priority fee, max fee — is the difference between consistently overpaying and paying roughly what inclusion is worth.'
    ],
    sections: [
      ['The base fee adjusts itself', [
        'Each block has a target size. If the previous block was fuller than target, the base fee rises; if emptier, it falls. The adjustment is capped per block, so the fee climbs or drops smoothly rather than spiking randomly.',
        'The base fee is burned, not paid to the validator. That removes the incentive for a producer to stuff blocks with their own transactions to inflate it.'
      ]],
      ['The priority tip buys ordering', [
        'The tip is the part that actually goes to the block producer, and it is what decides whether you are included now or in a few blocks. On a quiet chain a minimal tip is enough; during congestion the tip is the competitive variable.',
        'A tip far above the going rate buys you position in the next block and nothing else. It does not make the transaction more likely to succeed.'
      ]],
      ['Max fee is a ceiling, not a payment', [
        'You set a maximum you are willing to pay per unit of gas. You are charged the base fee at inclusion plus your tip, and the difference is returned. Setting a generous ceiling protects against a rising base fee without costing anything when the fee does not rise.',
        'This is widely misunderstood: a high max fee is not a high payment. A high tip is.'
      ]],
      ['What this looks like on rollups', [
        'Rollups follow the same transaction format but their cost is dominated by posting data back to Ethereum. Their execution fee is tiny and their data fee moves with mainnet conditions, so a rollup gets more expensive when mainnet does — just from a much lower base.',
        'Practically: on a rollup the tip rarely matters. On mainnet during congestion it is the only thing that matters.'
      ]]
    ],
    facts: [
      ['Base fee', 'Set by the protocol from block fullness; burned'],
      ['Priority tip', 'Paid to the block producer; buys inclusion order'],
      ['Max fee', 'A ceiling. Unused amount is refunded at inclusion'],
      ['Rollups', 'Dominated by data-posting cost, which tracks mainnet']
    ],
    faqs: [
      { q: 'If I set a high max fee, do I pay it?', a: 'No. You pay the prevailing base fee plus your tip, and the remainder up to your ceiling is returned. The ceiling only prevents your transaction being stranded if the base fee rises while you wait.' },
      { q: 'Why is my transaction stuck with a low tip?', a: 'Producers order by what they earn. With a tip below the current market your transaction waits until demand falls. You can replace it with the same nonce and a higher tip, which is what wallets call speed-up.' },
      { q: 'Does a higher fee make a swap succeed?', a: 'No. Fees buy inclusion, not outcome. A swap that reverts on a slippage check reverts identically whether you paid a small tip or a large one — and you pay the gas either way.' }
    ]
  }),

  article({
    slug: 'layer-2-fees-vs-ethereum',
    cluster: 'fees',
    icon: 'network',
    title: 'Why Layer 2 Fees Are Lower — and What Moves Them',
    description:
      'Rollups batch transactions and post compressed data to Ethereum. That is where the saving comes from, and why L2 fees still rise with mainnet.',
    h1: 'Where a rollup actually saves you money',
    intro: [
      'A rollup is not cheap because it cut corners on security. It is cheap because hundreds of transactions share the cost of one settlement on Ethereum, and because that settlement posts compressed data rather than full execution.',
      'The consequence is that a rollup fee has two parts with completely different behaviour, and only one of them is under the rollup\'s control.'
    ],
    sections: [
      ['Execution cost is genuinely small', [
        'Running your transaction on the rollup itself costs almost nothing. The sequencer has abundant capacity relative to demand, so the execution portion of the fee is typically a rounding error.',
        'This is why simple transfers and swaps on rollups cost cents or less while the same operation on mainnet can cost dollars.'
      ]],
      ['Data cost is inherited from Ethereum', [
        'The rollup must publish enough data for anyone to reconstruct its state. That publication happens on Ethereum and is priced by Ethereum. Dedicated data space made this dramatically cheaper than it used to be, but it still moves with mainnet demand.',
        'So when mainnet is congested, rollup fees rise too — from a much lower base, and usually by a smaller absolute amount than the saving.'
      ]],
      ['Optimistic and zero-knowledge differ in withdrawal, not fees', [
        'Optimistic rollups assume validity and allow a challenge window, which is why a native withdrawal to Ethereum takes days. Zero-knowledge rollups publish a validity proof, so withdrawal can be fast once the proof is on-chain.',
        'Both compress data the same way, so the day-to-day fee experience is similar. The difference shows up when you want your funds back on mainnet.'
      ]],
      ['Choosing a network for cost', [
        'For small and medium trades, any supported rollup or low-fee chain beats mainnet by a wide margin. For large trades, depth matters more than the few dollars of gas, and mainnet often has the deepest pools.',
        'FBT Swap supports Ethereum alongside Arbitrum, Base, Optimism, Linea, Scroll, zkSync Era and Unichain, and shows the fee and route for the network you actually selected.'
      ]]
    ],
    facts: [
      ['Execution on L2', 'Near-zero; capacity is abundant'],
      ['Data posting', 'Priced by Ethereum — this is why L2 fees still move'],
      ['Optimistic vs ZK', 'Similar fees; very different withdrawal latency'],
      ['Choose L2 when', 'Trade size is small enough that fixed gas matters']
    ],
    faqs: [
      { q: 'Are layer 2 networks less secure?', a: 'They inherit settlement security from Ethereum but add their own assumptions — sequencer behaviour, proof systems and upgrade keys among them. "Inherits Ethereum security" is accurate about settlement and incomplete about everything else.' },
      { q: 'Why did my rollup fee suddenly triple?', a: 'Almost always because mainnet data costs rose. The rollup did not change its pricing; the Ethereum space it must buy got more expensive for a while.' },
      { q: 'Can I move tokens between rollups directly?', a: 'Only through a bridge, which is a separate transaction with its own cost and its own risk. Two rollups do not share state just because they settle to the same chain.' }
    ]
  }),

  article({
    slug: 'liquidity-provider-fee-tiers',
    cluster: 'fees',
    icon: 'leaf',
    title: 'Pool Fee Tiers: The Cost Hidden Inside the Price',
    description:
      'Every pool charges the trader a percentage that goes to its liquidity providers. Why tiers exist, how the router chooses, and why cheapest is not best.',
    h1: 'The pool fee you never see as a line item',
    intro: [
      'The rate a swap interface quotes already has the pool fee inside it. You do not pay it separately and you never see it itemised, which is why most people believe a DEX swap costs only gas.',
      'It is usually the second-largest cost in the transaction, and on deep stable pairs it is the largest.'
    ],
    sections: [
      ['What the tiers are for', [
        'Pairs that barely move against each other — two dollar stablecoins, two wrapped forms of the same asset — use a very low tier, often a few hundredths of a percent, because providers take almost no inventory risk and the business is volume.',
        'Volatile majors sit in the middle. Exotic and newly launched pairs charge the most, because a provider there is genuinely likely to end up holding the wrong side.'
      ]],
      ['Why the cheapest tier does not always win', [
        'The same pair often exists in several tiers simultaneously. A router comparing them does not pick the lowest percentage; it picks the best net output, and a higher-fee pool with far deeper reserves frequently beats a cheap but shallow one.',
        'That is the correct answer even though it looks wrong on a fee comparison, because price impact on the shallow pool costs more than the fee difference saves.'
      ]],
      ['Concentrated liquidity changes the shape', [
        'Newer AMM designs let providers place liquidity in a price range instead of across the whole curve. Inside that range the pool behaves as if it were enormously deeper; outside it, the liquidity is simply not there.',
        'For a trader this means depth can vary sharply with price. A pair that executed beautifully yesterday can be thin today because the price has moved out of where the liquidity is concentrated.'
      ]],
      ['Separating it from the platform fee', [
        'The pool fee goes to liquidity providers. The platform fee is what the interface charges — on FBT Swap, 0.70% of the input on supported routes, shown in the quote before you sign. Gas goes to the network.',
        'Three recipients, three mechanisms. Any comparison of swap venues that only counts one of them is incomplete.'
      ]]
    ],
    facts: [
      ['Who receives it', 'The liquidity providers of that specific pool'],
      ['Typical range', 'Hundredths of a percent on stables to ~1% on exotic pairs'],
      ['Router logic', 'Best net output, not lowest fee tier'],
      ['Separate from', 'Network gas and the 0.70% platform fee']
    ],
    faqs: [
      { q: 'Why is the pool fee not shown separately?', a: 'Because it is applied inside the pool\'s pricing formula rather than charged on top. The quoted rate is already net of it, which is accurate but makes the cost easy to overlook.' },
      { q: 'Can I choose a lower-fee pool myself?', a: 'Not in this interface. The aggregator selects the path with the best net output for your size, which already accounts for the fee tier and the depth together.' },
      { q: 'Do fee tiers differ by network?', a: 'Yes. The same protocol can deploy different tiers on different chains, and each chain has its own dominant venues. This is one reason an identical pair quotes differently across networks.' }
    ]
  }),

  article({
    slug: 'bridge-fees-explained',
    cluster: 'fees',
    icon: 'arrow',
    title: 'What a Cross-Chain Bridge Actually Charges You',
    description:
      'A bridge transfer has a source gas fee, a destination gas fee, a protocol fee and often a liquidity spread. Four costs, usually quoted as one.',
    h1: 'The four costs inside one bridge transaction',
    intro: [
      'Bridging looks like a transfer and is priced like a trade. The single number a bridge shows you is an aggregate, and knowing its parts is how you tell a reasonable quote from a bad one.',
      'It also explains why bridging a small amount is often worse value than bridging a large one — some of the costs are fixed.'
    ],
    sections: [
      ['Gas on both sides', [
        'You pay gas on the source chain to lock, burn or deposit. Something then has to execute on the destination chain to mint or release, and that costs gas too. Most bridges pay the destination gas for you and bill it inside the quote.',
        'These two are fixed per transfer, so they dominate small amounts and become negligible on large ones.'
      ]],
      ['The protocol fee', [
        'The bridge charges for the service, typically as a percentage with a minimum. The minimum is what makes very small transfers uneconomic, and it is often the part that is easiest to miss in a quote shown as a single output figure.',
        'Comparing bridges means comparing the final amount received, not the advertised percentage.'
      ]],
      ['Liquidity spread on fast routes', [
        'A fast bridge does not wait for finality. It pays you immediately from a pool on the destination chain and settles later. That liquidity has a cost, and it appears as a spread between what you send and what arrives.',
        'The spread widens when the route is imbalanced — if everyone is moving in one direction, the pool on the receiving side is depleted and the price of immediacy rises.'
      ]],
      ['Deciding whether to bridge at all', [
        'Sometimes the cheaper path is not to bridge: swap into a stablecoin, move it via a route you already use, or simply trade on the chain where your funds already are. The point of a multi-chain interface is that the second option is usually available.',
        'And bridging carries risk that a swap does not — bridge contracts have been among the largest single points of loss in crypto. The guide on bridge risk covers that in detail.'
      ]]
    ],
    facts: [
      ['Source gas', 'Fixed per transfer, paid in the source chain native coin'],
      ['Destination gas', 'Usually bundled into the quote by the bridge'],
      ['Protocol fee', 'A percentage with a minimum — the minimum hurts small transfers'],
      ['Liquidity spread', 'The price of immediacy on fast routes; widens when imbalanced']
    ],
    faqs: [
      { q: 'Why did I receive less than the amount I sent?', a: 'Because the quote nets out destination gas, the protocol fee and any liquidity spread. Compare bridges on the amount received, not on the headline percentage.' },
      { q: 'Is a slower bridge cheaper?', a: 'Often, yes. Canonical routes that wait for finality avoid paying for someone else\'s liquidity, so they cost less and take longer. Optimistic rollup withdrawals are the extreme case — cheapest and measured in days.' },
      { q: 'Can a bridge transfer fail halfway?', a: 'The usual failure is a delay rather than a loss, with funds recoverable once the route clears. Genuine loss has happened through bridge contract exploits, which is a different and much more serious risk class.' }
    ]
  }),

  article({
    slug: 'hidden-costs-of-crypto-trading',
    cluster: 'fees',
    icon: 'privacy',
    title: 'The Crypto Trading Costs Nobody Puts on the Invoice',
    description:
      'Spread, price impact, MEV, failed-transaction gas, idle approvals and bridge spreads. Six costs that are real, measurable and almost never quoted.',
    h1: 'Six costs that never appear as a fee',
    intro: [
      'Ask what a swap costs and most people will name the platform fee. It is usually the easiest cost to see and frequently not the largest one.',
      'The costs below are all real transfers of value away from you. None of them appears as a line labelled "fee", which is exactly why they are worth listing.'
    ],
    sections: [
      ['Price impact and spread', [
        'Trading into a pool that is shallow relative to your size costs you the difference between the market rate and your average fill. On a thin pair that is routinely several percent — an order of magnitude above any platform fee.',
        'It is visible before you sign, as a price-impact figure. Most people read the output amount and not that number.'
      ]],
      ['Extraction by transaction ordering', [
        'A sandwich takes value bounded by your slippage tolerance and leaves no trace on your receipt. You simply received slightly less than the quote implied, which is indistinguishable from ordinary market movement unless you inspect the block.',
        'It is a cost, it is avoidable in part, and it is never invoiced.'
      ]],
      ['Gas on transactions that did nothing', [
        'Failed swaps, approvals you never used, and transfers to the wrong place all consume gas. A pattern of reverts during volatility can quietly exceed what the successful trades cost in fees.',
        'The fix is usually diagnostic rather than financial: find out why they revert instead of retrying with a bigger tolerance.'
      ]],
      ['Standing permissions and stranded dust', [
        'An unused unlimited approval is not a monetary cost until it is, at which point it is the whole balance. Dust — token remainders too small to swap economically — is a smaller but permanent loss on every chain you have ever used.',
        'FBT Swap charges 0.70% of the input on supported routes and shows it before you sign. The point of this page is that comparing interfaces on that number alone will mislead you.'
      ]]
    ],
    facts: [
      ['Price impact', 'Often the largest cost on thin pairs; shown before signing'],
      ['MEV', 'Bounded by your slippage tolerance; never itemised'],
      ['Failed gas', 'Charged in full for transactions that changed nothing'],
      ['Dust and approvals', 'Permanent small losses and open-ended risk respectively']
    ],
    faqs: [
      { q: 'Which cost is usually biggest?', a: 'For small trades, fixed network gas. For large trades on thin pairs, price impact. The platform fee is rarely the largest component in either case, which is why single-number comparisons are unreliable.' },
      { q: 'Can I measure what I actually paid?', a: 'Yes. Compare the market mid-price at the block your transaction landed in against your effective rate, then subtract the known fees. The remainder is impact plus any extraction.' },
      { q: 'Does a zero-fee interface cost less overall?', a: 'Not necessarily. An interface charging no explicit fee can route through worse paths, widen the quoted rate, or monetise order flow. The number that matters is tokens received, not the fee label.' }
    ]
  }),

  article({
    slug: 'cex-vs-dex-fees',
    cluster: 'fees',
    icon: 'grid',
    title: 'Centralised vs Decentralised Exchange Costs, Compared Fairly',
    description:
      'A CEX charges trading fees and withdrawal fees but no gas. A DEX charges gas and pool fees but no withdrawal. The honest comparison is end to end.',
    h1: 'Comparing CEX and DEX costs without cheating',
    intro: [
      'Most comparisons of the two are rigged by choosing where the journey starts and ends. A centralised exchange looks cheaper if you ignore deposit and withdrawal; a decentralised one looks cheaper if you ignore gas.',
      'The only fair comparison measures the same complete journey: money in your own wallet at the start, a different asset in your own wallet at the end.'
    ],
    sections: [
      ['What each side charges', [
        'A centralised venue charges a maker or taker fee on the trade and a withdrawal fee to send the asset on-chain. Internal transfers and the trade itself cost no gas because nothing touches a blockchain until you withdraw.',
        'A decentralised venue charges a pool fee inside the price, network gas per transaction, and whatever the interface adds. Nothing is held, so there is no deposit or withdrawal step at all.'
      ]],
      ['Where the crossover sits', [
        'For small amounts on an expensive chain, the centralised route often wins on pure cost because it amortises one withdrawal across many internal trades. For anything on a cheap network, the decentralised route usually wins outright.',
        'For large amounts, depth decides it and the answer depends on the specific pair rather than the venue type.'
      ]],
      ['The costs that are not money', [
        'A centralised account requires identity verification, is subject to withdrawal limits and freezes, and places your assets on someone else\'s balance sheet. A decentralised interface requires you to manage keys, and makes every mistake permanent.',
        'Those are real costs on both sides. Which one you prefer to carry is a genuine choice, not a technical question.'
      ]],
      ['An honest summary', [
        'If you value unattended execution, fiat on-ramps and deep order books, a regulated centralised venue does things a DEX cannot. If you value holding your own keys, no account, and access to tokens before any listing, a DEX does things a CEX cannot.',
        'FBT Swap is the second kind: 0.70% of the input on supported routes, gas separate and paid to the chain, no deposits, no withdrawal fee, and no account.'
      ]]
    ],
    facts: [
      ['CEX costs', 'Trading fee plus withdrawal fee; no gas while funds stay internal'],
      ['DEX costs', 'Pool fee plus gas per transaction; no deposit or withdrawal step'],
      ['Small trades', 'Favour a CEX on an expensive chain; a cheap chain flips it'],
      ['Non-monetary', 'Identity and counterparty risk versus key management risk']
    ],
    faqs: [
      { q: 'Is a DEX always more expensive for beginners?', a: 'No, but it often is on Ethereum mainnet, where fixed gas dominates a small trade. On a low-fee network the same trade can cost a fraction of a centralised venue\'s withdrawal fee alone.' },
      { q: 'Why does a CEX have no gas fee?', a: 'Because an internal trade is a database update, not a blockchain transaction. Gas appears only when you withdraw, which is also where the custodial relationship ends.' },
      { q: 'Can I compare them on one number?', a: 'Only end to end: start with assets in your own wallet, finish with the target asset in your own wallet, and count everything in between including deposits, withdrawals, gas and spread.' }
    ]
  }),

  article({
    slug: 'how-to-reduce-crypto-fees',
    cluster: 'fees',
    icon: 'check',
    title: 'Practical Ways to Pay Less in Crypto Fees',
    description:
      'Choose the network first, batch trades, keep slippage tight, reuse allowances and avoid reverts. The changes that actually move the number.',
    h1: 'What actually reduces what you pay',
    intro: [
      'Most fee advice is noise. A handful of changes produce almost all of the saving available to a normal user, and they are mostly about where and how often you transact rather than clever settings.',
      'Here they are in order of how much they are worth.'
    ],
    sections: [
      ['Choose the network before anything else', [
        'This is worth more than every other item combined. The same swap can differ by two orders of magnitude in gas between Ethereum mainnet and a rollup or low-fee chain. No setting recovers that difference.',
        'Check whether the pair you want has adequate depth on the cheaper network — if it does, there is nothing to think about.'
      ]],
      ['Transact less often', [
        'Every transaction pays gas again. Four small buys cost four lots of gas and four lots of approval overhead; one larger buy pays once. If your plan is accumulation rather than timing, fewer and larger is simply cheaper.',
        'The same applies to moving funds. Each hop between chains and wallets is a fee; plan the route once instead of discovering it one transaction at a time.'
      ]],
      ['Stop paying for reverts', [
        'Reverted transactions cost full gas and achieve nothing. Diagnose the reason rather than retrying: a stale quote, a missing allowance, a tight tolerance on a volatile minute and a transfer-fee token are four different problems with four different fixes.',
        'Keeping tolerance as tight as the pair allows also removes most of the sandwich exposure, which is a cost you were paying invisibly.'
      ]],
      ['Housekeeping that pays for itself', [
        'Reuse an existing allowance rather than re-approving. Consolidate dust while gas is low rather than when you need it. Hold a small gas buffer on each network you use so you are never forced to bridge at a bad moment.',
        'FBT Swap shows the route, the price impact and the 0.70% platform fee in the quote, so the comparison between networks takes seconds rather than guesswork.'
      ]]
    ],
    facts: [
      ['Biggest lever', 'Network choice — worth more than everything else combined'],
      ['Second', 'Fewer, larger transactions instead of many small ones'],
      ['Third', 'Eliminating reverts by diagnosing the actual cause'],
      ['Free', 'Tight slippage, reused allowances and a maintained gas buffer']
    ],
    faqs: [
      { q: 'Does trading at night save money?', a: 'On Ethereum mainnet it can, because the base fee follows demand for block space. On rollups and low-fee chains the saving is usually too small to be worth timing, and price movement while you wait is a bigger factor.' },
      { q: 'Are gas tokens or refund schemes still useful?', a: 'Largely no. The mechanisms that made them work were removed or neutered by protocol changes, and schemes that still advertise them are often marketing rather than a real saving.' },
      { q: 'Does FBT Swap offer a lower fee for larger trades?', a: 'The platform fee is 0.70% of the input on supported routes and is shown in the quote before you sign. The variable you control is the network and the size, which is where the real saving sits.' }
    ]
  }),

  article({
    slug: 'failed-transaction-gas-cost',
    cluster: 'fees',
    icon: 'alert',
    title: 'Why You Pay for a Transaction That Did Nothing',
    description:
      'A revert undoes state but not work. Why the network keeps the fee, how much a failure costs, and how to stop paying it repeatedly.',
    h1: 'Paying for failure: why a revert still costs gas',
    intro: [
      'It is the most counterintuitive charge in crypto: the transaction achieved nothing, your balances are unchanged, and the fee is gone. This is not a penalty and not a bug.',
      'Validators executed your code to find out that it would fail. That execution consumed real resources on thousands of machines, and the fee pays for it.'
    ],
    sections: [
      ['What a revert undoes and what it does not', [
        'A revert rolls back every state change the transaction attempted — balances, allowances, pool reserves. It does not roll back the computation itself, because that already happened, nor the nonce in most cases.',
        'If it were free to fail, an attacker could flood the network with transactions designed to revert and pay nothing for the load.'
      ]],
      ['How much a failure actually costs', [
        'Usually less than the successful version would have cost, because execution stops at the failing check rather than completing the whole route. A slippage revert on a swap typically burns a meaningful fraction of the full cost, not all of it.',
        'The exception is out-of-gas: that consumes the entire gas limit you set, because execution ran until there was nothing left.'
      ]],
      ['The repeat-failure trap', [
        'Three reverts in a row on a volatile pair can cost more than accepting a slightly wider tolerance once would have. Conversely, raising tolerance to force a transfer-fee token through converts a free failure into a permanent loss.',
        'The deciding question is always which of the five causes you are actually hitting — the guide on failed swaps lists them with their signatures.'
      ]],
      ['Nobody can refund it', [
        'Gas is paid to validators and partially burned. It never reaches the interface, so no interface can return it, and a service that offers to refund network gas is either subsidising you from its own funds or is not telling the truth.',
        'FBT Swap re-quotes immediately before signing, which removes the stale-quote revert — the single most common avoidable cause.'
      ]]
    ],
    facts: [
      ['What is charged', 'Gas for computation actually performed'],
      ['What is undone', 'Every balance and state change the transaction attempted'],
      ['Worst case', 'Out-of-gas, which consumes the entire gas limit'],
      ['Refundable', 'No. The fee went to validators and the burn, not to any interface']
    ],
    faqs: [
      { q: 'Is a failed transaction a sign of a scam?', a: 'Not usually. The common causes are mechanical. A token that can be bought but never sold is a different matter — that is a honeypot, and it looks like a repeated sell-side failure.' },
      { q: 'Can I cancel a pending transaction to avoid the fee?', a: 'You can replace it with a zero-value transaction to yourself using the same nonce and a higher tip. That replacement itself costs gas, so it is cheaper than a bad fill but not free.' },
      { q: 'Does a failed transaction affect my wallet?', a: 'No, beyond the gas. Balances are unchanged, approvals are unchanged, and there is no record that affects future transactions other than the nonce having advanced.' }
    ]
  }),

  article({
    slug: 'stablecoin-swap-costs',
    cluster: 'fees',
    icon: 'receipt',
    title: 'Stablecoin Swaps: Small Fees, Sharp Edges',
    description:
      'USDT to USDC should cost almost nothing. When it does not — depegs, wrong-chain versions, shallow pools — and how to check before you trade.',
    h1: 'Why a stablecoin swap can still go wrong',
    intro: [
      'Swapping one dollar stablecoin for another is the cheapest trade in crypto when it works. Specialised pools price them at a tiny fee because neither side is expected to move.',
      'The failures are therefore not about fees. They are about which version of the token you hold, and whether the peg is holding at that moment.'
    ],
    sections: [
      ['Why the fee is so low', [
        'Stable-to-stable pools use a curve designed for assets that trade near parity, giving very deep effective liquidity around 1:1 and a fee tier measured in hundredths of a percent. Price impact stays negligible for sizes that would move a normal pool.',
        'That holds while both assets are near their peg. It stops holding the moment one is not.'
      ]],
      ['The wrong-version problem', [
        'There are multiple tokens called USDC on several chains: a native issuance and one or more bridged versions. They are different contracts with different liquidity and different redemption rights, and a pool for one is not a pool for the other.',
        'Checking the contract address, not the symbol, is the whole defence. The networks guide covers native versus bridged in detail.'
      ]],
      ['When a peg slips', [
        'During a depeg the specialised curve works against you: it is built to assume parity, so it offers a lot of liquidity at prices that are no longer fair. Trading into it while the price is moving can execute far from where you expected.',
        'This is the one case where a stablecoin swap deserves the same care as a volatile pair — check the live rate, not the assumption.'
      ]],
      ['Practical checks', [
        'Confirm the contract address of both tokens. Check the quoted rate is close to 1:1 and look at the price impact figure rather than assuming it is zero. On an expensive network, remember fixed gas can still exceed the entire fee.',
        'FBT Swap shows rate, impact and the 0.70% platform fee before you sign, which makes an off-parity quote immediately visible instead of surprising.'
      ]]
    ],
    facts: [
      ['Pool fee', 'Hundredths of a percent on dedicated stable curves'],
      ['Main risk', 'Holding a bridged version with its own shallow pool'],
      ['Second risk', 'Trading into a stable curve while a peg is moving'],
      ['Check', 'Contract address, live rate and price impact — never the symbol alone']
    ],
    faqs: [
      { q: 'Are all stablecoins equally safe?', a: 'No. Backing, redemption rights, issuer jurisdiction and transparency differ substantially between them, and an algorithmic stablecoin is a different risk class entirely from a fully reserved one.' },
      { q: 'Why did my USDC swap have high price impact?', a: 'Most likely you hold a bridged version whose pool is far shallower than the native one, or the pair you selected routes through a volatile intermediate. Check the contract address first.' },
      { q: 'Is it worth swapping stables to save on fees?', a: 'Only if the destination pool is meaningfully deeper for your next trade. On a cheap network it can be; on an expensive one the gas for two transactions usually erases the gain.' }
    ]
  })
];
