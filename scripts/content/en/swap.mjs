/**
 * CLUSTER: swap & routing — 12 English spokes.
 * Each page answers one question a person types before or during a swap.
 */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'how-dex-aggregator-routing-works',
    cluster: 'swap',
    icon: 'network',
    title: 'How a DEX Aggregator Chooses Your Swap Route',
    description:
      'An aggregator compares pools across a network, splits the trade if that pays better, and returns one quote. Here is what it optimises and what it cannot see.',
    h1: 'How a DEX aggregator chooses your route',
    intro: [
      'A decentralised exchange is a single pool of two tokens. An aggregator is the layer above it that asks many pools the same question — how much of token B do I get for this much of token A — and returns the best answer it can assemble.',
      'That assembly is the interesting part. The best route is often not one pool but several, used in parallel or in sequence, because every pool charges a price that worsens as your trade grows relative to its depth.'
    ],
    sections: [
      ['What the aggregator is actually comparing', [
        'For each candidate path the router simulates the trade against current pool reserves and subtracts the pool fee, then subtracts an estimate of the gas each extra hop costs. A two-hop route through a deeper pool can beat a direct one-hop route, and on a cheap network it usually does; on Ethereum mainnet the gas for that second hop can erase the gain entirely.',
        'This is why the same pair quotes differently on different networks. It is not that one chain has a better price — it is that the gas cost of complexity changes which route wins.'
      ]],
      ['Splitting one trade across several pools', [
        'Every automated market maker gives you a worse rate the more you buy, because you are moving along a curve. Splitting 40% of the order into one pool and 60% into another keeps both trades near the shallow end of their curves, and the combined output beats either pool alone.',
        'Split routing only pays when the saved price impact exceeds the extra gas. Below a certain trade size the router stops splitting, which is why small swaps often show a single simple path.'
      ]],
      ['Why the quote changes between pages', [
        'A quote is a snapshot of pool reserves at a block. Other people trade in the blocks between your quote and your signature, so the reserves move and the output moves with them. That is what slippage tolerance exists to absorb.',
        'A quote that never moves would be a lie about a live market. FBT Swap re-requests the route before you sign and shows the new figure rather than submitting a stale one.'
      ]],
      ['What the router cannot see', [
        'It cannot see a token that charges a fee on transfer, unless the simulation catches it, so a quote for a tax token can overstate what lands in your wallet. It cannot see what the next block will contain, so it cannot promise the price. And it cannot judge whether the token is worth owning.',
        'FBT Swap asks public aggregators on the selected network, shows the route, the price impact and the 0.70% platform fee, and hands the transaction to your wallet. The signature — and the decision — stay with you.'
      ]]
    ],
    facts: [
      ['Inputs to the route', 'Pool reserves, pool fee tier, hop count and estimated gas'],
      ['Split routing', 'Used when reduced price impact outweighs the extra gas'],
      ['Quote lifetime', 'Seconds — reserves change with every block'],
      ['Platform fee', '0.70% of the input, shown in the quote before you sign']
    ],
    faqs: [
      { q: 'Does an aggregator always find the best price?', a: 'It finds the best price among the pools and paths it queries at that moment. A pool it does not index, or liquidity that appears a second later, is invisible to it. "Best available in this query" is an accurate description; "best possible" is not.' },
      { q: 'Why does the route have three hops for a simple pair?', a: 'Because the direct pool was too shallow for your size. Routing through a deeper intermediate token — usually a stablecoin or the wrapped native coin — costs more gas but less price impact, and the router only chooses it when that trade is favourable.' },
      { q: 'Can I force a specific pool?', a: 'Not through this interface. FBT Swap submits the aggregator route that quoted best. If you need a specific venue you would interact with that protocol directly, and you would be responsible for the route quality yourself.' }
    ]
  }),

  article({
    slug: 'slippage-tolerance-explained',
    cluster: 'swap',
    icon: 'alert',
    title: 'Slippage Tolerance: What Number Should You Actually Use?',
    description:
      'Slippage tolerance is the worst price you will accept. Set it too low and the swap reverts; too high and you invite a sandwich. How to pick it per pair.',
    h1: 'Slippage tolerance, and what number to use',
    intro: [
      'Slippage tolerance is not a prediction and not a fee. It is an instruction to the smart contract: if the output falls below this amount, abort the whole transaction and give me nothing instead.',
      'Every value you can set is a trade between two failure modes. Too tight and your swap reverts while still costing gas. Too loose and you have told the world you will accept a much worse price, which is an invitation.'
    ],
    sections: [
      ['What the number actually does', [
        'The router computes a minimum-received amount from your quote and your tolerance, and writes it into the transaction. On execution the contract checks the real output against that floor. Above it, the swap completes at whatever the real price was — you are not charged the tolerance. Below it, the transaction reverts.',
        'So tolerance never costs you money directly. It only decides whether a trade that moved against you still goes through.'
      ]],
      ['Picking a value by pair, not by habit', [
        'Deep stablecoin pairs on a busy network move very little between quote and block; 0.1% to 0.3% is usually enough. Major pairs like ETH to USDC sit comfortably around 0.5%. A thin token with a few thousand dollars of liquidity can move several percent from your own trade alone, and will need more.',
        'If a pair only executes at 5% or more, that is information. It means the pool is shallow relative to your size, and the honest response is usually a smaller trade rather than a bigger tolerance.'
      ]],
      ['Why a high tolerance attracts sandwiches', [
        'A searcher watching the mempool can buy ahead of you, let your trade push the price up, then sell into it. Their profit is bounded by exactly one number: how much worse than quoted you said you would accept. A 10% tolerance on a thin pair is a public offer of up to 10% of your trade.',
        'This is why "just raise slippage until it goes through" is bad advice. It converts a failed transaction into a successful but expensive one, and the cost is invisible because the swap appears to have worked.'
      ]],
      ['Tax tokens and the tolerance trap', [
        'Some tokens take a percentage on every transfer. The pool maths is fine but the amount that arrives is short, so the contract sees an output below the floor and reverts. People then raise tolerance above the token tax to force it through — and permanently accept that tax as slippage.',
        'If a token only swaps at 12% tolerance, the right question is what that 12% is paying for, not how to make the button work.'
      ]]
    ],
    facts: [
      ['What it is', 'The minimum output you will accept, enforced on-chain'],
      ['Too low', 'Transaction reverts; gas is still spent'],
      ['Too high', 'Sets the ceiling for a sandwich attack against you'],
      ['Typical', '0.1–0.3% deep stables · ~0.5% majors · more only with a reason']
    ],
    faqs: [
      { q: 'Do I pay the slippage percentage?', a: 'No. You pay the real execution price. Tolerance only sets the floor below which the transaction cancels itself, so a 1% tolerance on a swap that executes at the quoted price costs you nothing extra.' },
      { q: 'My swap keeps reverting. Should I raise slippage?', a: 'Only after checking why. A volatile minute, a shallow pool and a transfer-fee token all cause reverts and only one of them is fixed by a higher tolerance. Raising it blindly can turn a free failure into a paid loss.' },
      { q: 'Does FBT Swap set slippage for me?', a: 'A default is proposed and you can change it before signing. The value is written into the transaction your own wallet signs, so the limit is enforced by the contract, not by our interface.' }
    ]
  }),

  article({
    slug: 'price-impact-vs-slippage',
    cluster: 'swap',
    icon: 'chart',
    title: 'Price Impact vs Slippage — They Are Not the Same Thing',
    description:
      'Price impact is the cost your own trade creates. Slippage is the drift between quote and execution. Confusing them is how people overpay on thin pairs.',
    h1: 'Price impact is not slippage',
    intro: [
      'These two numbers sit next to each other in every swap interface and mean completely different things. One is caused by you. The other is caused by everyone else.',
      'Getting them the wrong way round leads to a specific, expensive mistake: raising slippage tolerance to fix a price-impact problem, which does nothing except guarantee you pay the impact.'
    ],
    sections: [
      ['Price impact: the cost you create', [
        'An automated market maker prices along a curve. Buying moves you up that curve, so the last unit of a large order costs more than the first. Price impact is the gap between the pool price before your trade and the average price you actually get.',
        'It is a function of your size against the pool depth, and it is fully knowable before you sign. A 3% price impact means you are paying 3% more than the market rate because the pool is not deep enough for your order.'
      ]],
      ['Slippage: the cost others create', [
        'Between your quote and your transaction landing in a block, other trades execute against the same pool. The reserves move, so your output differs from the quote. That drift is slippage, and it can go in your favour as often as against you on a calm pair.',
        'You cannot know it in advance. You can only bound it, which is what slippage tolerance does.'
      ]],
      ['Why the distinction decides what to do', [
        'High price impact is solved by trading less, splitting across time, or choosing a network where the pair has deeper liquidity. No tolerance setting touches it.',
        'High slippage is solved by faster inclusion, a quieter moment, or a private transaction path. No trade-size change touches it.'
      ]],
      ['Reading both numbers before you sign', [
        'FBT Swap shows the quoted rate, the price impact and the 0.70% platform fee in the same panel. If price impact is large, the interface says so rather than burying it — a swap that quietly costs 8% because the pool is thin is the single most common avoidable loss for a retail trader.',
        'A useful habit: if price impact exceeds roughly 1%, check whether the same pair is deeper on another supported network before continuing.'
      ]]
    ],
    facts: [
      ['Price impact', 'Caused by your own size against pool depth; knowable in advance'],
      ['Slippage', 'Caused by other trades between quote and block; bounded, not known'],
      ['Fix for impact', 'Smaller trade, split over time, deeper pool or another network'],
      ['Fix for slippage', 'Faster inclusion or a calmer moment — not a bigger trade']
    ],
    faqs: [
      { q: 'Does raising slippage tolerance reduce price impact?', a: 'No. Price impact is already in the quote. Raising tolerance only widens the band of post-quote drift you will accept, so on a high-impact trade it makes the swap succeed at the bad price instead of failing for free.' },
      { q: 'Is a 5% price impact ever acceptable?', a: 'Only if you know you are paying it and the alternative is worse. On a thin new token it may be the only route that exists. On a major pair it means you should split the trade or switch network.' },
      { q: 'Why is price impact different on each network?', a: 'Because liquidity is per-chain. The same pair can have tens of millions of dollars of depth on one network and a few thousand on another, and your identical order hits a completely different curve.' }
    ]
  }),

  article({
    slug: 'token-approvals-explained',
    cluster: 'swap',
    icon: 'key',
    title: 'Token Approvals: The Signature Before the Swap',
    description:
      'Before a contract can move your ERC-20 tokens you must approve it. What an allowance is, why unlimited approvals are risky, and how to keep them small.',
    h1: 'What you are agreeing to when you approve a token',
    intro: [
      'The first time you swap a given ERC-20 token, your wallet asks for two signatures, not one. The first is the approval. It does not move anything — it grants a contract permission to move that token on your behalf, up to an amount you set.',
      'Approvals are the most under-read signature in crypto and the mechanism behind most drained wallets. The theft does not happen at approval time, which is exactly why it works.'
    ],
    sections: [
      ['Why approvals exist at all', [
        'The ERC-20 standard has no way for a contract to pull tokens from you unprompted. Instead the token contract keeps an allowance ledger: owner, spender, amount. A swap router calls transferFrom, the token checks the allowance, and the transfer succeeds only within that limit.',
        'Native coins — ETH, BNB, POL, AVAX — do not need this. They travel with the transaction itself, which is why swapping a native coin is a single signature.'
      ]],
      ['Unlimited versus exact allowances', [
        'Many interfaces default to an effectively unlimited allowance so you never approve that token again. It is convenient and it is a standing permission: whatever that contract is, or becomes, can move your entire balance of that token at any future moment.',
        'An exact allowance costs one extra approval per swap in gas and removes that standing exposure. On cheap networks the trade-off is easy; on Ethereum mainnet it is a real cost you weigh.'
      ]],
      ['The attack that uses nothing but approvals', [
        'A drainer site shows something harmless — a claim button, a mint, an airdrop check — and requests an approval for a valuable token. Nothing leaves your wallet, so nothing looks wrong. Hours or weeks later the spender calls transferFrom and takes the balance.',
        'The defence is reading the approval screen: which token, which spender address, and what amount. If a page that should not need your USDT is asking for unlimited USDT, that is the whole attack visible in one line.'
      ]],
      ['Keeping the list short', [
        'Allowances persist until you change them. Reviewing them periodically and revoking the ones you no longer use removes exposure you are not using, which is the cheapest security improvement available to most wallets.',
        'FBT Swap requests approvals only for the token you are swapping and only for the aggregator router that will execute it. Your wallet shows the spender address; that address is worth a glance every time.'
      ]]
    ],
    howTo: [
      ['Read the token and the spender', 'Check which token the approval is for and which contract address is being authorised. A mismatch with what you are doing is the end of the process.'],
      ['Choose an amount', 'Prefer an exact amount for valuable balances. Reserve unlimited approvals for tokens you trade constantly and whose spender you trust.'],
      ['Approve, then swap', 'The approval is its own on-chain transaction and costs gas. The swap follows as a second signature.'],
      ['Review later', 'Re-check your allowances periodically and revoke anything you no longer use. An unused allowance is pure downside.']
    ],
    facts: [
      ['What it is', 'Permission for a contract to move a specific ERC-20 up to a limit'],
      ['What it is not', 'A transfer. No tokens move at approval time'],
      ['Native coins', 'ETH, BNB, POL and other gas coins need no approval'],
      ['Risk', 'Allowances persist until revoked, including on abandoned contracts']
    ],
    faqs: [
      { q: 'Does approving a token cost gas?', a: 'Yes. An approval is a state change on the token contract, so it is a normal transaction with a normal network fee. It is usually cheaper than the swap that follows.' },
      { q: 'Is an unlimited approval always dangerous?', a: 'It is a standing permission, so the risk equals the trustworthiness of the spender contract for as long as it exists. For a long-lived audited router it is a considered trade-off; for an unknown contract on a site you just found, it is the main way people lose funds.' },
      { q: 'Can FBT Swap move my tokens with an approval?', a: 'The approval you grant goes to the aggregator router contract that executes the swap, not to a custodial account. FBT Swap holds no funds and cannot initiate a transfer without the transaction you sign.' }
    ]
  }),

  article({
    slug: 'why-swap-transactions-fail',
    cluster: 'swap',
    icon: 'alert',
    title: 'Why a Swap Fails — and Why You Still Paid Gas',
    description:
      'Reverted swaps have a handful of real causes: slippage, deadline, allowance, gas limit, token tax. How to read the error and fix the right one.',
    h1: 'Why your swap failed, and why gas was still charged',
    intro: [
      'A failed swap is not a bug and not money stolen. The network ran your transaction, something in it did not hold, and the contract undid every state change — except the gas you spent asking.',
      'That is the part that feels unfair and is actually the point: validators did the work of executing your code, so the work is paid for whether or not the outcome was what you wanted.'
    ],
    sections: [
      ['The five causes that cover almost everything', [
        'Output below your minimum: price moved past your slippage tolerance. Deadline passed: the transaction sat unconfirmed too long. Insufficient allowance: the approval was missing, too small, or spent. Out of gas: the gas limit was below what the route needed. Transfer-fee token: the amount arriving was short because the token taxed it.',
        'Each of those produces a different fix, which is why "increase slippage and retry" solves roughly one case in five.'
      ]],
      ['Reading the revert in the explorer', [
        'Open the transaction on the network explorer and look at the status and the revert reason. Strings like INSUFFICIENT_OUTPUT_AMOUNT, EXPIRED, TRANSFER_FROM_FAILED and out of gas map directly onto the causes above.',
        'If the explorer shows no revert string, check the gas used against the gas limit. A transaction that consumed exactly the limit ran out of gas rather than failing a check.'
      ]],
      ['When retrying is the wrong move', [
        'Each retry costs gas. If the pool is thin and the price impact is large, three retries at rising tolerance can cost more than the amount you were trying to save by not splitting the trade.',
        'If the token takes a fee on transfer, no retry at the same settings will ever succeed, and a retry at a tolerance above the tax succeeds only by paying the tax.'
      ]],
      ['Reducing the failure rate', [
        'Quote and sign promptly rather than leaving the screen open. Keep a sensible gas buffer in the native coin of the network you are on. Use an allowance that actually covers the trade. On a volatile minute, accept that a wider tolerance on a deep pair is cheaper than three reverts.',
        'FBT Swap re-quotes before signing and shows the network, the route and the fee, which removes the stale-quote case — the one that produces the most avoidable reverts.'
      ]]
    ],
    facts: [
      ['Gas on failure', 'Charged. Execution happened; only the state change was undone'],
      ['Most common cause', 'Output fell below the minimum set by slippage tolerance'],
      ['Never fixed by retrying', 'A token that charges a fee on every transfer'],
      ['Where to look', 'The network explorer: status, revert reason, gas used vs limit']
    ],
    faqs: [
      { q: 'Did I lose my tokens in a failed swap?', a: 'No. A revert undoes every balance change in the transaction. Your tokens are where they were; the only loss is the gas the network consumed while running it.' },
      { q: 'Why does the same swap fail repeatedly?', a: 'Because the cause is structural, not random. A thin pool, a stale allowance or a transfer-fee token will fail the same way every time until the underlying condition changes.' },
      { q: 'Can FBT Swap refund gas on a failed swap?', a: 'No. Gas is paid to the network validators, not to FBT Swap, and no interface can reverse or refund it. This is true of every non-custodial interface.' }
    ]
  }),

  article({
    slug: 'limit-orders-vs-market-swaps',
    cluster: 'swap',
    icon: 'bell',
    title: 'Limit Orders vs Market Swaps on a Decentralised Exchange',
    description:
      'On-chain limit orders need either custody of your funds or a standing allowance. What that means, and what a non-custodial price alert does instead.',
    h1: 'Limit orders on a DEX: what the fine print really says',
    intro: [
      'On a centralised exchange a limit order is trivial: the exchange holds your money, so it can fill you at 03:00 while you sleep. On-chain the same feature needs a mechanism, and every mechanism has a cost someone must accept.',
      'Understanding which mechanism a given app uses tells you exactly what you are handing over.'
    ],
    sections: [
      ['The three ways a DEX limit order can work', [
        'Custodial escrow: you deposit into the protocol and it trades on your behalf. Signed intent with an allowance: you pre-sign an order and grant a spending allowance that a keeper uses when your price is hit. Alert plus manual signature: the condition is watched and you sign the swap yourself when it triggers.',
        'The first two can fill without you present. Both require giving something up — custody in the first case, a standing allowance in the second.'
      ]],
      ['What the allowance model really grants', [
        'A signed order with an open allowance means a third-party keeper can move that token from your wallet when its conditions are satisfied. The conditions are enforced by a contract, which is real protection, but the permission exists continuously and is only as sound as that contract.',
        'This is a reasonable design and it is not custody-free in the sense people usually assume. It is worth knowing which one you agreed to.'
      ]],
      ['What FBT Swap does instead', [
        'FBT Swap records the condition — a target price, a trailing stop, a take-profit with a stop-loss, a ladder — and watches it. When it triggers you get a notification where delivery is available, and you review the live quote and sign the swap yourself.',
        'The honest consequence is stated on the screen: nothing fills while you are asleep. In exchange, no contract holds a permission over your balance and no keeper can move anything.'
      ]],
      ['Choosing between them', [
        'If unattended execution matters more than a standing permission, use a protocol built for it and read what the allowance covers. If you would rather nothing can move without your signature, an alert-plus-sign flow is the design that matches.',
        'What you should not do is assume a "non-custodial limit order" fills without any permission at all. Something has to be able to act, and that something was authorised by you.'
      ]]
    ],
    facts: [
      ['Custodial escrow', 'Fills unattended; the protocol holds your funds'],
      ['Signed intent + allowance', 'Fills unattended; a keeper holds a spending permission'],
      ['Alert + manual signature', 'Never fills unattended; no permission is granted'],
      ['FBT Swap', 'Alert and manual signature — by design, and stated on screen']
    ],
    faqs: [
      { q: 'Will FBT Swap execute my order while the app is closed?', a: 'No. It watches the condition and can notify you when notifications are enabled and reachable. Execution requires you to review the live quote and sign in your own wallet.' },
      { q: 'Is a signed-intent limit order unsafe?', a: 'Not inherently. It is a different trade: the contract enforces your price, and in exchange a keeper holds a permission over that token. Safe depends on the contract and on whether you intended to grant it.' },
      { q: 'What happens if the price passes my target while I am away?', a: 'The condition is recorded as met and the alert is sent where delivery is possible. The swap itself still waits for you, and the price may have moved again by then — which is the honest cost of this design.' }
    ]
  }),

  article({
    slug: 'amm-vs-order-book',
    cluster: 'swap',
    icon: 'layers',
    title: 'AMM vs Order Book: Two Completely Different Markets',
    description:
      'An order book matches buyers to sellers. An AMM prices from a reserve formula. The difference explains slippage, liquidity depth and why DEX prices drift.',
    h1: 'AMMs and order books price your trade differently',
    intro: [
      'Both give you a price for a pair, and that is where the similarity ends. One is a queue of human intentions; the other is a formula applied to a pile of tokens.',
      'Almost every confusing thing about decentralised trading — why price impact exists, why liquidity providers lose money on volatility, why a quote has no size tiers — follows from which of the two you are using.'
    ],
    sections: [
      ['How an order book sets the price', [
        'Participants post bids and asks at chosen prices and sizes. The best bid and best ask define the spread, and your market order eats through the book from the best price outward. Depth is literally the list of orders waiting.',
        'Prices come from people deciding what they will accept. Nobody is obliged to quote, so a quiet market can have a wide spread or no quote at all.'
      ]],
      ['How an AMM sets the price', [
        'A constant-product pool holds reserves of two tokens and prices every trade so the product of the reserves stays constant after the fee. There are no orders and no counterparty with an opinion — just a curve and whatever is in the pool.',
        'This guarantees a quote at any size, which is the great advantage, and guarantees that large trades get progressively worse prices, which is price impact.'
      ]],
      ['What each one costs you', [
        'On an order book you pay the spread and any taker fee, and you can be filled at several prices as you consume depth. On an AMM you pay the pool fee plus price impact determined by your size against the reserves.',
        'For small trades on a deep pool the AMM is usually cheaper and always available. For very large trades a deep order book can be far better, which is why size matters more than venue branding.'
      ]],
      ['Why liquidity providers behave differently', [
        'An order-book maker chooses prices and can cancel. An AMM liquidity provider cannot — the curve keeps quoting as the market moves, so the pool systematically sells the asset that is rising and buys the one that is falling. That is the mechanism behind impermanent loss.',
        'FBT Swap routes across AMM pools on each supported network and across Solana aggregators. The quote you see already includes the pool fee and the measured price impact for your size.'
      ]]
    ],
    facts: [
      ['Order book', 'Prices come from posted bids and asks; depth is a list'],
      ['AMM', 'Prices come from a reserve formula; depth is a curve'],
      ['Always-on quote', 'AMM yes, order book only while makers are present'],
      ['Large trades', 'Favour deep order books; AMMs charge rising price impact']
    ],
    faqs: [
      { q: 'Which gives a better price?', a: 'It depends on size against depth. Small and medium trades on a well-funded pool usually clear cheaper on an AMM; very large orders can be far cheaper on a deep order book because they do not walk a curve.' },
      { q: 'Why does an AMM quote me at all when nobody wants to trade?', a: 'Because the pool is not a person. The formula produces a price from the reserves regardless of sentiment, which is why there is always a quote and why it can be a bad one.' },
      { q: 'Do decentralised order books exist?', a: 'Yes, including on-chain and hybrid designs, and some perpetual venues use them. They solve the price-impact problem and introduce different ones — matching latency, maker incentives and sequencer trust among them.' }
    ]
  }),

  article({
    slug: 'liquidity-pools-explained',
    cluster: 'swap',
    icon: 'leaf',
    title: 'What a Liquidity Pool Is and Who Pays for It',
    description:
      'A pool is two token reserves plus a fee. Traders pay the fee, providers take the inventory risk. Depth, fee tiers and why TVL is not safety.',
    h1: 'Liquidity pools: two reserves, one fee, real risk',
    intro: [
      'A liquidity pool is a smart contract holding reserves of two tokens. Anyone can trade against it at the price its formula produces, and anyone can add to the reserves and earn a share of the trading fees.',
      'That is the whole mechanism. Everything else — depth, impermanent loss, fee tiers, concentrated liquidity — is a refinement of who takes which risk.'
    ],
    sections: [
      ['Depth is the only thing that decides your price', [
        'A pool holding two million dollars a side absorbs a ten-thousand-dollar trade with negligible impact. A pool holding twenty thousand does not. Same token, same interface, completely different execution.',
        'This is why checking depth matters more than checking the logo. A token can be listed everywhere and tradeable nowhere at size.'
      ]],
      ['Fee tiers and what they are for', [
        'Stable pairs typically use a very low fee because the two assets barely move against each other and volume is the business. Volatile pairs use a higher fee because providers need compensating for inventory risk. Exotic pairs charge the most.',
        'A pair can exist in several tiers at once; the router picks whichever gives the better net output for your size, which is sometimes the more expensive tier because it holds deeper reserves.'
      ]],
      ['Why providing liquidity is not free money', [
        'Fees accrue continuously, but so does divergence loss. As the price of one asset moves, the pool rebalances against you: you end up holding more of the loser and less of the winner than if you had simply held both.',
        'Fees can exceed that loss on a high-volume, low-volatility pair. They often do not on a volatile one. Any yield figure that omits this comparison is incomplete.'
      ]],
      ['Reading a pool before you trade into it', [
        'Look at reserves on both sides, recent volume, and the price impact your specific size produces. A pool with large total value locked but a lopsided reserve is thinner than its headline number suggests.',
        'FBT Swap shows the price impact for the amount you entered, which is the practical version of all of this: if the number is large, the pool is too small for your trade.'
      ]]
    ],
    facts: [
      ['What it holds', 'Reserves of two tokens in one smart contract'],
      ['Who pays', 'Traders pay the pool fee on every swap'],
      ['Who is exposed', 'Providers carry divergence loss and contract risk'],
      ['What matters for you', 'Depth against your size — not total value locked']
    ],
    faqs: [
      { q: 'Does high TVL mean a safe pool?', a: 'No. Total value locked measures size, not safety. A large pool can still hold an unaudited contract, a centrally upgradeable token, or reserves that are lopsided in a way that makes your direction expensive.' },
      { q: 'Where does my swap fee go?', a: 'The pool fee goes to the liquidity providers of that pool, proportionally to their share. It is separate from network gas and separate from any platform fee the interface charges.' },
      { q: 'Can a pool run out of a token?', a: 'A constant-product pool cannot be fully emptied — the price goes to infinity as a reserve approaches zero. In practice it becomes unusably expensive long before that, which looks like the token being untradeable.' }
    ]
  }),

  article({
    slug: 'mev-and-sandwich-attacks',
    cluster: 'swap',
    icon: 'shield',
    title: 'MEV and Sandwich Attacks: The Fee Nobody Invoices',
    description:
      'Searchers reorder transactions for profit. A sandwich buys before you and sells after. What makes you a target and how to be a worse one.',
    h1: 'MEV: the cost that never appears on a receipt',
    intro: [
      'Maximal extractable value is the profit available from choosing the order of transactions in a block. Some of it is harmless arbitrage that keeps prices aligned. Some of it is taken directly from a specific user, and sandwiching is that kind.',
      'It does not show up as a fee. It shows up as an execution price slightly worse than it should have been, which is why most people never notice paying it.'
    ],
    sections: [
      ['How a sandwich works', [
        'Your pending swap is visible before it is included. A searcher submits a buy of the same token ahead of yours, your trade executes at the price their buy created, and they sell immediately after into the price your trade created.',
        'Their profit is bounded by your slippage tolerance. Everything they take was inside the band you publicly agreed to accept.'
      ]],
      ['What makes a trade worth attacking', [
        'Size relative to pool depth, a generous slippage tolerance, and a pair volatile enough that nobody questions the result. A small swap on a deep stable pair is not worth the gas to attack; a large swap on a thin pair with 5% tolerance is.',
        'The attacker needs your transaction to be visible and your tolerance to leave room. Remove either and the attack stops being profitable.'
      ]],
      ['Practical defences', [
        'Set tolerance to the smallest value that reliably executes for that pair. Split large orders so no single transaction is worth sandwiching. Prefer deeper pools, which may mean a different supported network for the same pair.',
        'Where a private transaction route is available from your wallet or the network, it removes mempool visibility entirely, which is the strongest available defence.'
      ]],
      ['The part no interface can fix', [
        'No front end can promise MEV protection it does not control. Block ordering belongs to validators and builders, and an interface that claims to eliminate extraction is overstating what it can do.',
        'FBT Swap shows the quote, the price impact and your tolerance before you sign, and does not add a hidden spread of its own. That is the honest boundary: visibility and a tight band, not immunity.'
      ]]
    ],
    facts: [
      ['What it is', 'Profit from ordering transactions within a block'],
      ['Sandwich bound', 'Exactly your slippage tolerance — nothing more'],
      ['Best defence', 'Tight tolerance, smaller clips, deeper pools, private routing'],
      ['Visible as', 'A worse fill, never a line item']
    ],
    faqs: [
      { q: 'Was I sandwiched?', a: 'Check the block your swap landed in on the explorer. A buy of the same token immediately before yours and a sell immediately after, from the same address, is the signature. Receiving less than quoted on its own is not proof.' },
      { q: 'Does a low slippage tolerance stop MEV?', a: 'It shrinks the profit available from sandwiching you, often below the attacker\'s gas cost, which removes the incentive. It does not affect other forms of extraction such as back-running arbitrage.' },
      { q: 'Is all MEV an attack?', a: 'No. Arbitrage that realigns a stale pool price benefits everyone trading into that pool afterwards, and liquidations are a necessary function of lending markets. Sandwiching is the subset taken from a specific user.' }
    ]
  }),

  article({
    slug: 'best-time-to-swap-crypto',
    cluster: 'swap',
    icon: 'history',
    title: 'When to Swap: Gas Windows, Volatility and Patience',
    description:
      'Gas is cheapest when block space is quiet and spreads are tightest when volume is high. Those are different moments. How to choose which one matters.',
    h1: 'Choosing when to swap, with real reasons',
    intro: [
      'Timing a swap is not about predicting price. It is about two measurable things that genuinely move: how congested the network is, and how deep the market is at that hour.',
      'They pull in opposite directions, so the right answer depends on whether gas or execution quality is the bigger share of your cost.'
    ],
    sections: [
      ['Gas follows block-space demand', [
        'On Ethereum mainnet the base fee rises when blocks are full and falls within minutes when they are not. Quiet windows are typically outside overlapping US and European working hours, and during periods without a major mint, launch or liquidation cascade.',
        'On rollups and low-fee chains the absolute numbers are small enough that this rarely decides anything, which is itself a reason to choose the network first.'
      ]],
      ['Liquidity follows attention', [
        'Pools are deepest and spreads tightest when the most participants are active, which is roughly the opposite of the cheap-gas window. Trading a thin pair at 04:00 to save a dollar of gas can cost several times that in price impact.',
        'For a small trade on a cheap network, gas dominates. For a large trade, depth dominates and you should trade when the market is awake.'
      ]],
      ['Events that are worth avoiding entirely', [
        'Major macroeconomic prints, scheduled protocol upgrades, large token unlocks and the minutes around a liquidation cascade all widen spreads and raise revert rates simultaneously. The fill is worse and the chance of paying gas for nothing is higher.',
        'If a trade is not urgent, waiting an hour after such an event is usually free and measurably better.'
      ]],
      ['The honest limit of all of this', [
        'None of it predicts direction. Choosing a cheap, liquid moment improves execution of a decision you already made; it does not make the decision correct, and the price can move further against you while you wait.',
        'FBT Swap shows the live quote, route and fee at the moment you ask, which is the only timing information that is actually a fact rather than a forecast.'
      ]]
    ],
    facts: [
      ['Cheap gas', 'Quiet block space — usually off-peak hours on mainnet'],
      ['Best depth', 'Peak activity hours, when more participants are quoting'],
      ['Small trades', 'Gas dominates; optimise for the cheap window or a cheap network'],
      ['Large trades', 'Price impact dominates; optimise for depth']
    ],
    faqs: [
      { q: 'Is there a universally cheapest day to transact?', a: 'No. Demand for block space is driven by events, not by the calendar. Weekends are often quieter on mainnet, but a weekend mint or a liquidation cascade erases that instantly.' },
      { q: 'Should I wait for gas to drop before swapping?', a: 'Only if gas is a meaningful share of the trade. On a rollup or a low-fee chain the fee is often cents, and waiting exposes you to price movement far larger than the saving.' },
      { q: 'Does FBT Swap pick the cheapest moment for me?', a: 'No. It quotes and executes when you ask. It shows the network, the route, the price impact and the fee so the decision is informed, but it does not delay or schedule a trade on your behalf.' }
    ]
  }),

  article({
    slug: 'swap-small-amounts-crypto',
    cluster: 'swap',
    icon: 'receipt',
    title: 'Swapping Small Amounts Without Losing It All to Fees',
    description:
      'Below a certain size, gas and fees eat the trade. How to work out your break-even, which networks make small swaps viable, and when not to bother.',
    h1: 'Small swaps: the maths before you press go',
    intro: [
      'There is a trade size below which the costs exceed the point of trading. It is not a secret and it is easy to compute, but almost nobody does it before clicking.',
      'The number depends almost entirely on which network you are on, which is the single most useful thing to know about small trades.'
    ],
    sections: [
      ['Working out your break-even', [
        'Add the three costs: network gas for the swap (plus an approval if this is the first time you use that token), the pool fee inside the price, and the platform fee. On FBT Swap the platform fee is 0.70% of the input, shown before you sign.',
        'Divide the fixed part — gas — by your trade size. A two-dollar gas cost on a twenty-dollar swap is 10% before anything else. The same gas on a two-thousand-dollar swap is 0.1%.'
      ]],
      ['Why the network choice dominates', [
        'Gas is close to fixed per transaction and varies by orders of magnitude between networks. The same swap that costs several dollars on Ethereum mainnet can cost a fraction of a cent on a rollup or a high-throughput chain.',
        'For small amounts, choosing the network is not an optimisation. It is the difference between a viable trade and a donation to block producers.'
      ]],
      ['The costs people forget', [
        'The approval transaction is separate and is charged even though it moves nothing. Native-coin gas must already be in the wallet on that network, so a first trade there may need a bridge or a transfer first, each with its own cost.',
        'And a thin pool charges price impact that does not scale down — a small trade into a very small pool can still cost several percent.'
      ]],
      ['When the right answer is not to trade', [
        'If total costs exceed roughly 1–2% and the trade is not time-sensitive, accumulating and trading once is usually better than five small swaps. Each swap pays gas again; one larger swap pays it once.',
        'This is also the honest answer to "can I start with ten dollars?" — yes, on a cheap network, and no, on Ethereum mainnet. Stating that plainly is more useful than encouraging a trade that cannot work.'
      ]]
    ],
    facts: [
      ['Fixed cost', 'Gas per transaction, plus a separate approval the first time'],
      ['Variable cost', 'Pool fee, price impact and the 0.70% platform fee'],
      ['Decides everything', 'Which network you trade on'],
      ['Rule of thumb', 'If total cost exceeds 1–2%, batch the trade instead']
    ],
    faqs: [
      { q: 'What is the minimum sensible swap size?', a: 'There is no fixed figure because gas is not fixed. Compute it: gas divided by trade size, plus the pool fee, plus 0.70%. If that total is uncomfortable as a percentage, the trade is too small for that network.' },
      { q: 'Can I avoid the approval cost?', a: 'Only by swapping the native coin, which needs no approval, or by reusing an allowance you already granted for that token and spender. Otherwise it is a genuine one-off cost per token per spender.' },
      { q: 'Is the platform fee charged on tiny swaps too?', a: 'Yes — 0.70% of the input on supported routes, shown in the quote before you sign. It scales with the trade, so it is not what makes small swaps expensive; fixed gas is.' }
    ]
  }),

  article({
    slug: 'how-to-swap-crypto-step-by-step',
    cluster: 'swap',
    icon: 'check',
    title: 'How to Swap Crypto Safely: A Step-by-Step Walkthrough',
    description:
      'Connect a wallet, pick the network, check the quote, read the approval, verify the token address and sign. Each step with the specific thing to check.',
    h1: 'Swapping crypto, step by step, with the checks',
    intro: [
      'The mechanical steps of a swap take under a minute. The checks that stop you losing money take about the same, and almost all of them happen before the signature.',
      'This is the sequence, with the specific thing worth verifying at each point rather than a generic reminder to be careful.'
    ],
    sections: [
      ['Before you connect anything', [
        'Confirm the address bar. A phishing clone of a swap interface is visually identical and differs only in the domain. Type the address or use a bookmark you created yourself; do not arrive from a message, an advertisement or a search result you have not checked.',
        'FBT Swap has exactly one official domain, fbtswap.ir. Anything else using the name is not us, and nobody from the project will ever contact you first.'
      ]],
      ['Network and balance', [
        'Pick the network before anything else, because it decides liquidity, gas and which token contract you are actually trading. Make sure you hold the native coin of that network for gas — ETH on Ethereum and rollups, BNB on BNB Chain, POL on Polygon, AVAX on Avalanche, SOL on Solana.',
        'A wallet with tokens but no native coin cannot transact at all, which is the most common first-time dead end.'
      ]],
      ['Verifying the token you are buying', [
        'Symbols are not unique. Anyone can deploy a token called USDC. Paste or confirm the contract address from a source you trust — the official project site, or the token list the interface ships — and check it on the network explorer.',
        'If you cannot verify the address, you are not buying the thing you think you are buying.'
      ]],
      ['Reading the quote and signing', [
        'Check four numbers: the rate, the price impact, the slippage tolerance and the fee. Then read the wallet prompt itself — the approval screen names the token, the spender contract and the amount, and the swap screen names the network.',
        'Sign only when those match what you intended. After signature the transaction is irreversible; there is no support channel on earth that can undo it.'
      ]]
    ],
    howTo: [
      ['Open the real site', 'Verify the domain yourself before connecting. Use your own bookmark, never a link from a message.'],
      ['Connect your wallet', 'Approve the connection request. A connection reveals your address and lets the site propose transactions; it cannot move funds on its own.'],
      ['Select the network', 'Choose the chain you hold funds on and make sure you have its native coin for gas.'],
      ['Verify the token address', 'Match the contract address against a trusted source or the explorer. Symbols can be duplicated; addresses cannot.'],
      ['Read the quote', 'Check rate, price impact, slippage tolerance and the 0.70% platform fee before continuing.'],
      ['Approve if asked', 'Confirm the token, spender and amount on the approval screen. Prefer an exact amount for large balances.'],
      ['Sign the swap', 'Confirm in your wallet. The transaction settles on-chain and cannot be reversed by anyone.']
    ],
    facts: [
      ['Official domain', 'fbtswap.ir — there is no other'],
      ['Gas', 'Paid in the native coin of the selected network, separate from the fee'],
      ['Platform fee', '0.70% of the input, shown before you sign'],
      ['Reversibility', 'None. A signed on-chain transaction is final']
    ],
    faqs: [
      { q: 'Is connecting a wallet dangerous on its own?', a: 'A connection exposes your public address and lets the site propose transactions. It cannot move funds. The risk begins at the signature, which is why reading the wallet prompt matters more than the connect step.' },
      { q: 'What if I send to the wrong network?', a: 'Funds sent to an address on a chain that does not control it are usually unrecoverable. Check the network on both sides before any transfer; this is the mistake with the worst outcome and no remedy.' },
      { q: 'Do I need to register or verify my identity?', a: 'No FBT Swap account, email or identity document is required for the on-chain swap interface. Your wallet, a payment provider or a third-party protocol may apply their own checks.' }
    ]
  })
];
