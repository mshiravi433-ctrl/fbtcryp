/** CLUSTER: networks & bridging — 10 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'what-is-a-layer-2',
    cluster: 'networks',
    icon: 'layers',
    title: 'What a Layer 2 Is, and What It Borrows From Ethereum',
    description:
      'A rollup executes transactions off Ethereum and settles proofs or data back to it. What that inherits, what it does not, and where the trust sits.',
    h1: 'Layer 2: execution elsewhere, settlement on Ethereum',
    intro: [
      'A layer 2 is a separate execution environment that posts its results back to Ethereum. You transact on the rollup; Ethereum remains the place where the record is finally anchored.',
      'The phrase "inherits Ethereum security" is accurate about one specific property and misleading about several others, which is worth untangling before you move funds there.'
    ],
    sections: [
      ['What is genuinely inherited', [
        'Data availability and settlement. Because the rollup publishes enough information to Ethereum for anyone to reconstruct its state, you do not need the rollup operator\'s permission to prove what you own. In principle you can exit even if the operator stops cooperating.',
        'That property is real and is the reason rollups are treated differently from sidechains, which have their own validator set and their own security entirely.'
      ]],
      ['What is not inherited', [
        'Liveness and ordering. Almost every rollup today runs a single sequencer, which decides transaction order and can go offline. During an outage the chain stops for everyone, and Ethereum cannot help.',
        'Upgradeability is the other one. Rollup contracts are typically upgradeable by a multisig or a security council, which means the rules can change on a timescale shorter than any protocol change on Ethereum.'
      ]],
      ['Why this changes nothing day to day and everything in a crisis', [
        'In normal operation a rollup feels like a fast, cheap Ethereum. The differences surface when something breaks: a sequencer outage, a contested withdrawal, or an upgrade you disagree with.',
        'Knowing which assumptions you are accepting is the point. It is not an argument against using them — it is the difference between an informed choice and an assumption.'
      ]],
      ['Supported rollups here', [
        'FBT Swap supports Arbitrum One, Base, Optimism, Linea, Scroll, zkSync Era and Unichain alongside Ethereum itself, plus non-rollup networks including BNB Chain, Polygon, Avalanche, Sonic, Mantle, Berachain and Monad.',
        'The network is shown before every signature, because the same address existing on all of them is the most expensive source of confusion in multi-chain use.'
      ]]
    ],
    facts: [
      ['Inherited', 'Data availability and settlement from Ethereum'],
      ['Not inherited', 'Liveness, ordering and upgrade governance'],
      ['Usual architecture', 'A single sequencer with an upgradeable contract set'],
      ['Practical effect', 'Identical in normal use; different during an incident']
    ],
    faqs: [
      { q: 'Is a layer 2 as safe as Ethereum?', a: 'For settlement, the design intends it to be. For liveness and governance it is not — a sequencer can halt and contracts can be upgraded by a small group, neither of which applies to Ethereum itself.' },
      { q: 'What is the difference between a rollup and a sidechain?', a: 'A rollup posts data to Ethereum so its state can be reconstructed and exited independently. A sidechain has its own consensus and its own security budget, and a bridge to it is a trust relationship rather than a settlement guarantee.' },
      { q: 'Can I lose funds if a rollup shuts down?', a: 'A well-constructed rollup has an escape mechanism letting users withdraw directly through Ethereum. Whether that mechanism is live, tested and usable varies by network and is worth checking for anything significant.' }
    ]
  }),

  article({
    slug: 'optimistic-vs-zk-rollups',
    cluster: 'networks',
    icon: 'layers',
    title: 'Optimistic vs Zero-Knowledge Rollups: What Changes for You',
    description:
      'One assumes validity and allows challenges; the other proves it mathematically. The practical difference is withdrawal time, not daily fees.',
    h1: 'Two ways to prove a rollup told the truth',
    intro: [
      'Both kinds of rollup execute transactions off Ethereum and post data back. They differ in how they convince Ethereum that the posted state is correct.',
      'For a user the difference shows up in exactly one place, and it is not the fee.'
    ],
    sections: [
      ['The optimistic model', [
        'State is published as correct by default. Anyone can submit a fraud proof during a challenge window, typically seven days, and incorrect state is rolled back. Nobody needs to do anything if everything is honest, which keeps costs low.',
        'The cost is that a native withdrawal to Ethereum must wait out the window, because until it closes the state is not final.'
      ]],
      ['The validity-proof model', [
        'Each batch is accompanied by a cryptographic proof that the state transition was executed correctly. Ethereum verifies the proof, so there is nothing to challenge and no waiting period beyond proof generation and verification.',
        'The cost is computational: generating proofs is expensive and historically made full compatibility with the Ethereum virtual machine hard, though that gap has narrowed considerably.'
      ]],
      ['What you actually notice', [
        'Day-to-day fees are broadly similar, because both are dominated by the cost of posting data to Ethereum rather than by their proving model.',
        'Withdrawal is where they diverge: days on an optimistic rollup versus hours or less on a validity rollup. Third-party fast bridges exist for both and charge a liquidity spread to front you the funds.'
      ]],
      ['Choosing between them', [
        'If you move funds back to mainnet frequently, the withdrawal latency matters. If you mostly transact within the rollup ecosystem, it rarely does, and liquidity depth for your pairs is the better criterion.',
        'FBT Swap supports both kinds — Arbitrum, Base and Optimism on the optimistic side, zkSync Era, Scroll and Linea on the validity side — and quotes on whichever you select.'
      ]]
    ],
    facts: [
      ['Optimistic', 'Assumes validity; fraud proofs within a challenge window'],
      ['Validity (ZK)', 'Proves each batch; verified on Ethereum'],
      ['Fee difference', 'Small — both are dominated by data posting cost'],
      ['Real difference', 'Native withdrawal latency: days versus hours']
    ],
    faqs: [
      { q: 'Are ZK rollups more secure?', a: 'They replace a social assumption (someone will submit a fraud proof) with a cryptographic one (the proof verifies). That is a stronger guarantee for state correctness, and both still depend on sequencer behaviour and upgrade governance.' },
      { q: 'Why do fast bridges exist if withdrawal works?', a: 'Because the native route on an optimistic rollup takes about a week. A fast bridge pays you now from its own liquidity and claims the native withdrawal later, charging a spread for the service.' },
      { q: 'Does my wallet work the same on both?', a: 'On EVM-equivalent rollups, yes — same address, same tooling. Some validity rollups have historically differed in account handling or contract deployment, so check for anything beyond ordinary transfers and swaps.' }
    ]
  }),

  article({
    slug: 'evm-compatibility-explained',
    cluster: 'networks',
    icon: 'code',
    title: 'EVM Compatibility: Why One Address Works on Many Chains',
    description:
      'EVM chains share an execution model, an address format and a transaction format. What that means for your wallet, your tokens and your mistakes.',
    h1: 'What "EVM compatible" actually buys you',
    intro: [
      'The Ethereum Virtual Machine is a specification for how contract code executes and how accounts are derived. A chain that implements it can run the same contracts and recognise the same address format.',
      'That is enormously convenient and is the direct cause of the most expensive user error in crypto.'
    ],
    sections: [
      ['What is shared', [
        'Address derivation, so one key gives you the same address on Ethereum, BNB Chain, Polygon, Arbitrum, Base and every other EVM network. Transaction format, so one wallet speaks to all of them. Contract bytecode, so a protocol can deploy nearly unchanged code to each.',
        'Token standards too, which is why ERC-20 behaviour is predictable across chains.'
      ]],
      ['What is emphatically not shared', [
        'State. Your balance on one chain does not exist on another. A token deployed on Ethereum has no presence on Polygon unless someone deployed it there, and that deployment is a different contract at a different address.',
        'Chain ID separates them at the protocol level, which is what stops a transaction signed for one network being replayed on another.'
      ]],
      ['The mistake this enables', [
        'Because the address is identical everywhere, a transfer to the right address on the wrong network is accepted and recorded. The funds now sit on a chain where you may or may not control that address — and if the destination is an exchange or a contract, often you do not.',
        'Recovery depends entirely on whether whoever controls that address on that chain can and will act.'
      ]],
      ['Working safely across chains', [
        'Confirm the network on both sides of every transfer. Add tokens by contract address for the specific chain, never by symbol. Keep a small native-coin balance on each chain you use so you are never stuck.',
        'FBT Swap supports sixteen EVM networks plus Solana and displays the selected network before every signature, which is the one place this error can still be caught.'
      ]]
    ],
    facts: [
      ['Shared', 'Address format, transaction format, bytecode, token standards'],
      ['Not shared', 'Balances, contract deployments, liquidity'],
      ['Separator', 'Chain ID, which prevents cross-chain replay'],
      ['Main hazard', 'Correct address, wrong network — usually unrecoverable']
    ],
    faqs: [
      { q: 'Can I use one wallet for all EVM chains?', a: 'Yes. One key derives the same address on every EVM network, and wallets simply switch which chain they query and submit to.' },
      { q: 'Is a token automatically available on every EVM chain?', a: 'No. Each deployment is separate and has its own address and its own liquidity. A token on Ethereum does not exist on Base unless someone deployed or bridged it there.' },
      { q: 'Why does my balance disappear when I switch network?', a: 'Because it was never on the new network. The wallet is now querying a different chain where that address holds nothing. Switch back and the balance returns.' }
    ]
  }),

  article({
    slug: 'wrong-network-transfer-recovery',
    cluster: 'networks',
    icon: 'alert',
    title: 'Sent to the Wrong Network: What Is Actually Recoverable',
    description:
      'Some wrong-network transfers are retrievable, most are not. The deciding factor is who controls that address on the destination chain.',
    h1: 'Wrong network: the honest recovery picture',
    intro: [
      'This is the mistake with the worst ratio of ease to consequence. It takes one dropdown and the funds are on a chain you did not intend.',
      'Whether anything can be done comes down to a single question: does anyone control that address on the chain where the funds now sit?'
    ],
    sections: [
      ['Case one: you control the address', [
        'If you sent to your own address — the usual case when moving between your own wallets — the funds are at the same address on the other chain, and your key controls it there too.',
        'Add the network to your wallet, add the token by its contract address on that chain, acquire a small amount of that chain\'s native coin for gas, and move the funds. Annoying, not lost.'
      ]],
      ['Case two: an exchange deposit address', [
        'Exchange deposit addresses are frequently contracts or are only monitored on specific chains. If the exchange supports that chain and that token, support may be able to credit it, sometimes for a fee. If it does not, the funds are typically unrecoverable.',
        'This depends entirely on the exchange\'s internal tooling. It is a request, not a right.'
      ]],
      ['Case three: a contract address', [
        'Sending tokens to a contract that has no function to retrieve them leaves them permanently stuck. The contract owns them and nothing in its code can move them out.',
        'This is the usual outcome of sending to a token contract address instead of a wallet address, and it is final.'
      ]],
      ['Prevention, since recovery is unreliable', [
        'Verify the network on the sending and receiving side every single time. Send a small test amount for any first transfer to a new destination. For exchange deposits, use the address the exchange shows for that exact network, generated fresh.',
        'FBT Swap shows the selected network before each signature. That display is the last checkpoint before an irreversible action.'
      ]]
    ],
    facts: [
      ['Own address', 'Usually recoverable — add the network, add the token, move it'],
      ['Exchange deposit', 'Sometimes recoverable at the exchange\'s discretion'],
      ['Contract address', 'Almost always permanent'],
      ['Reliable fix', 'A small test transfer before any first transfer']
    ],
    faqs: [
      { q: 'Can FBT Swap recover a wrong-network transfer?', a: 'No. We hold no funds and have no control over any address. Recovery, where it is possible at all, depends on whoever controls the destination address on that chain.' },
      { q: 'I sent to my own address on another chain and see nothing. Why?', a: 'The wallet is not displaying that chain or that token. Add the network, then add the token by its contract address on that network — the balance is almost certainly there.' },
      { q: 'Is a native coin sent to the wrong chain recoverable?', a: 'If you control the address, yes — it is sitting there and you can move it. If you sent to a contract or an unsupported exchange address, usually not.' }
    ]
  }),

  article({
    slug: 'how-crypto-bridges-work',
    cluster: 'networks',
    icon: 'arrow',
    title: 'How a Crypto Bridge Works: Lock, Mint, Burn, Release',
    description:
      'Bridges do not move tokens. They lock on one side and issue a representation on the other, or use a liquidity pool. The model decides the risk.',
    h1: 'Nothing crosses a bridge — here is what happens instead',
    intro: [
      'Tokens cannot leave the chain they were issued on. A bridge creates the appearance of movement by locking the original and producing a claim on the destination, or by paying you out of a pool it already holds there.',
      'The mechanism matters because it determines what you now own and what has to stay solvent for it to be worth anything.'
    ],
    sections: [
      ['Lock and mint', [
        'The canonical model: your tokens are locked in a contract on the source chain and an equivalent amount is minted on the destination. Going back burns the minted tokens and releases the originals.',
        'What you hold on the destination is a claim backed by the locked reserve. Its value depends on that reserve remaining intact and the bridge remaining able to process redemptions.'
      ]],
      ['Liquidity networks', [
        'Rather than minting, the bridge pays you from a pool it maintains on the destination chain and rebalances later. You receive the real canonical asset immediately, which is why these routes feel instant.',
        'The cost is a spread, and it widens when flows are one-directional and the destination pool is depleted.'
      ]],
      ['Who is attesting to what', [
        'Something must tell the destination chain that the source-side event happened. That is either a set of external validators, an optimistic challenge period, a light client verifying the source chain, or a validity proof.',
        'External validator sets are the weakest and have been the source of the largest bridge losses. Light clients and proofs are stronger and more expensive to run.'
      ]],
      ['Practical consequences', [
        'A bridged token is not interchangeable with the native one. Two bridges produce two different tokens with two different pools, and liquidity for one says nothing about the other.',
        'Prefer canonical or native routes where they exist, check which asset you will actually receive, and treat the choice of bridge as a choice of counterparty.'
      ]]
    ],
    facts: [
      ['Lock and mint', 'You hold a claim on a locked reserve'],
      ['Liquidity network', 'You receive the real asset; the bridge rebalances later'],
      ['Attestation', 'Validator set, challenge window, light client or validity proof'],
      ['Consequence', 'Bridged and native versions are different tokens']
    ],
    faqs: [
      { q: 'Is a bridged token the same as the real one?', a: 'No. It is a separate contract whose value depends on the bridge remaining solvent and redeemable. Native issuance on the destination chain is a different and generally stronger instrument.' },
      { q: 'Why do bridges take different amounts of time?', a: 'Because of finality requirements and attestation model. Waiting for source-chain finality is slow and cheap; fronting you liquidity is fast and costs a spread.' },
      { q: 'Can a bridge transfer be reversed?', a: 'Not by you. A stuck transfer can sometimes be completed or refunded by the operator once the route clears, but that is their process, not a guarantee you hold.' }
    ]
  }),

  article({
    slug: 'bridge-risks-and-hacks',
    cluster: 'networks',
    icon: 'shield',
    title: 'Why Bridges Keep Getting Hacked',
    description:
      'Bridges concentrate value behind complex verification logic. The recurring failure patterns, and how to limit exposure when you must use one.',
    h1: 'Bridges are where the money and the complexity meet',
    intro: [
      'Several of the largest single losses in crypto have been bridge exploits. This is not bad luck — it follows from what a bridge is: a large pool of locked value guarded by code that must verify events on a chain it cannot execute.',
      'The failure patterns repeat, which makes them worth knowing before you choose a route.'
    ],
    sections: [
      ['Compromised validator sets', [
        'Many bridges rely on a set of external signers to attest that a deposit occurred. Compromise enough of those keys and you can authorise withdrawals that never had a matching deposit.',
        'Small signer sets, keys held by one organisation, and no timelock on withdrawals turn a key compromise into an immediate total loss.'
      ]],
      ['Verification bugs', [
        'The proof-checking logic is intricate and has repeatedly contained flaws: accepting a forged Merkle proof, mishandling an empty input, or failing to check that a message came from the expected contract. One accepted fake message can mint unlimited tokens.',
        'These are the most costly bugs in the space because the contract holds everything at once.'
      ]],
      ['Upgrade and admin keys', [
        'A bridge that can be upgraded by a single key can be drained by whoever holds it, whether through theft or decision. Timelocks and multisigs reduce this; their absence is a standing risk regardless of the code quality.',
        'This applies to the token contracts the bridge issues as well as to the bridge itself.'
      ]],
      ['Limiting your exposure', [
        'Do not treat a bridge as storage. Move, then move on. Prefer canonical routes operated by the destination chain over third-party bridges where both exist. Split large transfers rather than sending one large amount through one contract.',
        'FBT Swap routes swaps on each supported network; cross-chain movement remains a separate action with its own risk profile, and it is worth evaluating the specific bridge each time.'
      ]]
    ],
    facts: [
      ['Pattern one', 'Compromise of an external validator or signer set'],
      ['Pattern two', 'A flaw in proof or message verification logic'],
      ['Pattern three', 'Admin or upgrade keys without a timelock'],
      ['Mitigation', 'Canonical routes, short exposure, split large transfers']
    ],
    faqs: [
      { q: 'Are canonical bridges always safer?', a: 'They are usually operated by the destination chain\'s own team and use its native messaging, which removes one external trust layer. They still have upgrade keys and code risk, so safer is relative rather than absolute.' },
      { q: 'Is bridging a stablecoin safer than bridging a volatile token?', a: 'The bridge risk is identical. What differs is what you hold afterwards: a bridged stablecoin can trade below the native version if confidence in the bridge drops, which is a second exposure.' },
      { q: 'Should I avoid bridges entirely?', a: 'That is impractical in a multi-chain world. The realistic goal is minimising time and amount at risk, choosing better-governed routes, and not leaving funds sitting in a bridged representation longer than necessary.' }
    ]
  }),

  article({
    slug: 'native-vs-bridged-usdc',
    cluster: 'networks',
    icon: 'receipt',
    title: 'Native vs Bridged Stablecoins: Same Symbol, Different Asset',
    description:
      'A chain can host an issuer-minted stablecoin and several bridged versions at once. They trade separately, and only one is directly redeemable.',
    h1: 'Two tokens, one symbol, very different risk',
    intro: [
      'On several networks you will find more than one token displaying USDC or USDT. One may be issued directly by the issuer on that chain; the others are bridged representations created by third parties.',
      'They are separate contracts with separate liquidity and separate failure modes, and wallets often display them identically.'
    ],
    sections: [
      ['What native issuance means', [
        'The issuer mints and burns on that chain directly and honours redemption against it. The token is backed by the same reserves as on any other chain, and its value does not depend on a bridge remaining solvent.',
        'This is the version with the strongest claim and usually the deepest liquidity once it exists.'
      ]],
      ['What bridged means', [
        'A bridge locked the token on another chain and minted a representation here. Its value depends on the lock remaining intact and the bridge remaining able to process redemptions. If confidence in that bridge falls, the bridged token trades below par even though the underlying is fine.',
        'There can be several bridged versions on one chain, each from a different bridge, each with its own pool.'
      ]],
      ['How to tell them apart', [
        'By contract address, which is the only reliable method. Ticker variants such as a dot-e suffix are a convention, not a guarantee, and many interfaces normalise them away.',
        'Check the issuer\'s own documentation for the official address on the chain you are using, and compare it with what your wallet is showing.'
      ]],
      ['Why it affects your trade', [
        'Routing between a bridged version and a native one is a swap, not a conversion, and it has price impact. A deep pool for the native token tells you nothing about the depth available for a bridged one.',
        'FBT Swap shows the price impact for your amount, which is where a thin bridged pool becomes visible before you sign rather than after.'
      ]]
    ],
    facts: [
      ['Native', 'Minted by the issuer on that chain; directly redeemable'],
      ['Bridged', 'A claim backed by a lock on another chain'],
      ['Distinguish by', 'Contract address only — never the ticker'],
      ['Conversion', 'A swap with price impact, not a one-to-one exchange']
    ],
    faqs: [
      { q: 'Can a bridged stablecoin depeg while the native one does not?', a: 'Yes, and it has happened. The bridged token reflects confidence in the bridge; the native token reflects confidence in the issuer. Those are separate questions.' },
      { q: 'Which version should I hold?', a: 'Where native issuance exists, it carries fewer layers of risk and usually deeper liquidity. Where it does not, note which bridge issued the version you hold.' },
      { q: 'Will an exchange accept a bridged deposit?', a: 'Often not, or it will credit at a different rate. Check the exact contract the exchange expects before sending; this is a common and avoidable loss.' }
    ]
  }),

  article({
    slug: 'chain-ids-and-rpc-endpoints',
    cluster: 'networks',
    icon: 'network',
    title: 'Chain IDs and RPC Endpoints: The Plumbing You Should Check',
    description:
      'A chain ID identifies the network in every signature. An RPC endpoint is who you ask about state. Both can be wrong, and one can be hostile.',
    h1: 'Who you are asking, and which chain you are signing for',
    intro: [
      'Two configuration values decide what your wallet does: the chain ID written into every signature, and the RPC endpoint it queries for balances and submits transactions through.',
      'Both are usually invisible and both are worth understanding, because a wrong chain ID produces a useless transaction and a hostile RPC produces a convincing lie.'
    ],
    sections: [
      ['What the chain ID does', [
        'It is included in the signed payload so a transaction valid on one network cannot be replayed on another. This is why adding a network with the wrong chain ID produces signatures that no node will accept.',
        'It is also how a wallet knows which network a site is requesting, and how it can warn you that you are on the wrong one.'
      ]],
      ['What an RPC endpoint sees', [
        'Everything you ask it. Your address, your balance queries, your transaction before it is broadcast, and your IP address. A public endpoint is a service, and it is also an observer.',
        'A hostile or compromised endpoint can return false balances, hide transactions, or delay broadcasting while it front-runs you. It cannot sign anything, which is the limit of the damage.'
      ]],
      ['Adding networks safely', [
        'Get chain parameters from the network\'s own documentation or a reputable chain registry, not from a page that offers to add it for you. A malicious "add network" button can install a correct-looking network pointed at an endpoint the attacker controls.',
        'Verify the chain ID matches the official value, and prefer an endpoint operated by the chain or a provider you chose.'
      ]],
      ['When to care', [
        'Occasional use of a default public endpoint is fine for most people. If you transact at size, a private or paid endpoint removes both the observation and the reliability problem.',
        'FBT Swap ships configured endpoints for its supported networks and shows the chain before every signature, so the network you are signing for is never implicit.'
      ]]
    ],
    facts: [
      ['Chain ID', 'Signed into every transaction; prevents cross-chain replay'],
      ['RPC endpoint', 'Reads state and broadcasts; sees your address and IP'],
      ['A hostile RPC can', 'Lie about state, delay or censor broadcasts'],
      ['It cannot', 'Sign anything or move funds']
    ],
    faqs: [
      { q: 'Can a bad RPC steal my funds?', a: 'Not directly — it has no key. It can mislead you into signing something by showing false state, and it can observe and delay your transactions, so the damage is indirect but real.' },
      { q: 'Should I run my own node?', a: 'It is the strongest option for privacy and trust and is impractical for most people. A private endpoint from a provider you chose captures most of the benefit for far less effort.' },
      { q: 'Why did adding a network fail?', a: 'Usually a chain ID that does not match what the endpoint reports, or an unreachable endpoint. Both are configuration errors rather than wallet faults.' }
    ]
  }),

  article({
    slug: 'block-finality-explained',
    cluster: 'networks',
    icon: 'history',
    title: 'Finality: When a Transaction Is Genuinely Irreversible',
    description:
      'Confirmed is not final. Probabilistic finality, economic finality and instant finality differ, and the difference decides how long to wait.',
    h1: 'The difference between confirmed and final',
    intro: [
      'A transaction appearing in a block is not the same as that block being permanent. How permanent it is, and how quickly, depends on the consensus mechanism of the chain.',
      'This is why exchanges require different confirmation counts per network, and why "it showed up instantly" is not the same as "it cannot be undone".'
    ],
    sections: [
      ['Probabilistic finality', [
        'On proof-of-work and some proof-of-stake chains, each additional block makes a reorganisation exponentially less likely but never impossible. Finality is a confidence level you choose by waiting.',
        'This is why a deposit of a large amount requires more confirmations than a small one: the receiver is choosing how much reorganisation risk to accept.'
      ]],
      ['Economic finality', [
        'Ethereum finalises checkpoints roughly every two epochs. Reverting a finalised block would require a very large amount of staked value to be destroyed, which makes it economically irrational rather than merely improbable.',
        'Between inclusion and finalisation there is a window of a few minutes where reorganisation is possible, which matters for high-value settlement.'
      ]],
      ['Fast chains and rollups', [
        'High-throughput chains confirm quickly and define finality differently; some provide it in under a second, others rely on validator supermajorities. Rollups add another layer: a transaction is confirmed by the sequencer instantly and is only as final as Ethereum once the batch settles.',
        'This gap is why a rollup transaction can feel instant while a withdrawal to Ethereum takes much longer.'
      ]],
      ['What to do with this', [
        'For ordinary swaps, sequencer or block confirmation is sufficient — the trade executed and the tokens are in your wallet. For large transfers, for accepting payment, or for anything you cannot repeat, wait for the chain\'s stronger finality guarantee.',
        'FBT Swap shows the transaction hash so you can follow confirmation on the network explorer rather than guessing from the interface.'
      ]]
    ],
    facts: [
      ['Probabilistic', 'Confidence grows with each block; never absolute'],
      ['Economic', 'Reversal possible but prohibitively expensive — Ethereum finality'],
      ['Rollups', 'Instant from the sequencer, final once settled on Ethereum'],
      ['Rule', 'Match the wait to the value and to whether you can repeat it']
    ],
    faqs: [
      { q: 'How many confirmations are enough?', a: 'It depends on the chain and the amount. Receivers set their own thresholds for exactly this reason; following the destination service\'s requirement is the practical answer.' },
      { q: 'Can a confirmed transaction be reversed?', a: 'Before finality, a chain reorganisation can displace it. After finality on a chain that provides it, reversal would require destroying an enormous amount of staked value and is treated as impossible in practice.' },
      { q: 'Why is my rollup withdrawal still pending?', a: 'On an optimistic rollup the challenge window must elapse — typically about seven days — before the withdrawal can be claimed on Ethereum. This is the design working, not a fault.' }
    ]
  }),

  article({
    slug: 'choosing-a-network-for-swaps',
    cluster: 'networks',
    icon: 'check',
    title: 'Which Network Should You Actually Swap On?',
    description:
      'Liquidity depth for your pair, gas cost against your size, where your funds already are, and where you want to end up. In that order.',
    h1: 'Picking a network with four questions',
    intro: [
      'With seventeen networks available the choice can look arbitrary. It is not — four questions settle it almost every time, and they are quick to answer.',
      'The order matters, because optimising the wrong one first is how people end up bridging twice to save a dollar of gas.'
    ],
    sections: [
      ['Where are your funds now?', [
        'Trading where your assets already sit avoids a bridge entirely, with its fee, its delay and its risk. This usually dominates everything else for amounts that are not large.',
        'If the pair you want has adequate depth there, stop. You have your answer.'
      ]],
      ['Is the pair deep enough for your size?', [
        'Check the price impact for your actual amount, not the pair in the abstract. A major pair with millions in depth on one chain can have a few thousand on another, and your order hits a completely different curve.',
        'If price impact exceeds roughly one percent, it is worth comparing another network before continuing.',
        "Depth also changes through the day. A pair that is comfortable during active hours can thin out noticeably when its main participants are offline, and a quote taken at one hour is not a promise about another. Re-quote at the moment you intend to trade."
      ]],
      ['What does gas cost relative to the trade?', [
        'Fixed gas dominates small trades. A swap costing a few dollars of gas is irrelevant on a large trade and crippling on a small one, which is why network choice is effectively a function of size.',
        'For small amounts, any low-fee network beats mainnet by so much that nothing else needs considering.'
      ]],
      ['Where do you want the output?', [
        'If the tokens are going to a protocol, an exchange deposit or another wallet, trade on the chain that destination expects. Swapping on a cheap chain and then bridging the output often costs more than swapping where it was needed.',
        'FBT Swap supports BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Mantle, Berachain, Unichain, Monad, Scroll, zkSync Era, Robinhood Chain and Solana, and shows route, price impact and fee for whichever you select.'
      ]]
    ],
    facts: [
      ['First question', 'Where the funds already are — avoiding a bridge usually wins'],
      ['Second', 'Price impact for your actual size on that pair'],
      ['Third', 'Gas as a percentage of the trade'],
      ['Fourth', 'Where the output needs to end up']
    ],
    faqs: [
      { q: 'Is the cheapest network always best?', a: 'No. Cheap gas with thin liquidity can cost more in price impact than expensive gas with deep liquidity, particularly for larger trades. Compare the total, not the gas.' },
      { q: 'Should I bridge to get a better rate?', a: 'Only when the improvement clearly exceeds bridge cost, delay and risk. For most retail-sized trades it does not, and the bridge adds a failure mode the swap did not have.' },
      { q: 'How do I compare networks quickly?', a: 'Request a quote for the same pair and amount on each candidate and compare the output after fees. The price impact figure makes depth differences obvious immediately.' }
    ]
  })
];
