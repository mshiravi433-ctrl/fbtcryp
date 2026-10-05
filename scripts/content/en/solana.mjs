/** CLUSTER: Solana — 8 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'solana-token-accounts-and-rent',
    cluster: 'solana',
    icon: 'solana',
    title: 'Solana Token Accounts and Rent: Why Holding Costs SOL',
    description:
      'Each token you hold needs its own account, funded with a refundable rent deposit. What that costs, why it exists, and how to reclaim it.',
    h1: 'Every token you hold opens an account on Solana',
    intro: [
      'On an EVM chain, holding a token is an entry in that token\'s own ledger. On Solana, it is a separate account on-chain, derived from your wallet and the token mint, and accounts occupy state that must be paid for.',
      'That payment is rent, it is refundable, and it is the reason a Solana wallet needs SOL even to receive a token.'
    ],
    sections: [
      ['Associated token accounts', [
        'For each mint you hold, an associated token account is derived deterministically from your wallet address and that mint. It stores your balance for that specific token and nothing else.',
        'If it does not exist, the token cannot be received, which is why sending a token to a wallet that has never held it requires the sender or the wallet to create the account first.'
      ]],
      ['What rent actually is', [
        'Accounts must hold a minimum balance proportional to their size to be exempt from deletion. For a token account this is a small, fixed amount of SOL — typically around two thousandths of a SOL.',
        'It is a deposit, not a fee. Closing the account returns it in full to your wallet.'
      ]],
      ['The costs this creates', [
        'Receiving a new token costs rent plus transaction fees. A wallet that has interacted with dozens of tokens has that rent spread across dozens of accounts, which can add up to a non-trivial SOL balance sitting idle.',
        'Wallets increasingly offer a cleanup function that closes empty token accounts and reclaims the deposits.'
      ]],
      ['Practical implications', [
        'Always keep a SOL buffer for rent and fees, not just for the transaction itself. If a transfer fails because the recipient has no token account, that is the reason. Periodically close empty accounts to recover the SOL.',
        'FBT Swap routes Solana swaps through public aggregators and shows the quote and the fee before your wallet signs; account creation, when needed, appears in the transaction you approve.'
      ]]
    ],
    facts: [
      ['Per token', 'One associated token account, derived from wallet and mint'],
      ['Rent', 'A refundable SOL deposit, roughly 0.002 SOL per account'],
      ['Reclaimable', 'Yes — closing an empty account returns the deposit'],
      ['Consequence', 'You need SOL to receive tokens, not just to send them']
    ],
    faqs: [
      { q: 'Why do I need SOL to receive a token?', a: 'Because receiving it may require creating an associated token account, which must be funded with a rent-exempt deposit. The deposit is returned when the account is closed.' },
      { q: 'Can I get the rent back?', a: 'Yes. Closing a token account with a zero balance returns the full deposit to your wallet. Many wallets offer this as a cleanup action across all empty accounts at once.' },
      { q: 'Is rent charged continuously?', a: 'Not for rent-exempt accounts, which is effectively all of them now. The minimum balance makes the account permanent, so it is a one-off refundable deposit rather than an ongoing charge.' }
    ]
  }),

  article({
    slug: 'spl-vs-token-2022',
    cluster: 'solana',
    icon: 'layers',
    title: 'SPL and Token-2022: Two Standards, Different Surprises',
    description:
      'Token-2022 adds transfer fees, hooks, confidential balances and more. Useful features that also change what a transfer actually does.',
    h1: 'The newer Solana token standard can do things the old one cannot',
    intro: [
      'The original SPL token program is deliberately simple: mint, transfer, burn. Token-2022 adds optional extensions that attach behaviour to a token at the program level.',
      'Those extensions are legitimate and useful. They also mean that for a Token-2022 mint, a transfer may not do what a transfer normally does.'
    ],
    sections: [
      ['What the extensions can add', [
        'A transfer fee deducted on every movement. A transfer hook that calls arbitrary external logic on each transfer. Confidential transfers that hide amounts. Non-transferable tokens. Permanent delegate authority. Interest-bearing balances that update by formula.',
        'Each is opt-in per mint and is visible in the mint\'s configuration on-chain.'
      ]],
      ['Why this matters for swapping', [
        'A transfer fee means the amount arriving is less than the amount sent, so a quote based on the sent amount overstates the result. A transfer hook can make a transfer fail under conditions the sender cannot see.',
        'A permanent delegate means an authority can move tokens from any holder. That is a legitimate compliance feature for some issuers and a complete loss of control for a holder who did not know.'
      ]],
      ['Checking a mint before you buy', [
        'The mint account shows which extensions are enabled. Explorers surface this, and so do several Solana token tools. Look specifically for transfer fee, transfer hook and permanent delegate.',
        'A token with a permanent delegate is not a token you hold unconditionally, and that should be a conscious decision rather than a discovery.'
      ]],
      ['How interfaces handle it', [
        'Aggregators generally support Token-2022 mints and account for transfer fees in routing where they can detect them. Hooks are harder, because the external logic can behave differently at execution time.',
        'FBT Swap routes Solana swaps through public aggregators and shows the quote and fee before signing. For any token you selected by mint address, checking the extensions yourself is the reliable step.'
      ]]
    ],
    facts: [
      ['SPL', 'Simple mint, transfer and burn — no attached behaviour'],
      ['Token-2022', 'Optional extensions enabled per mint'],
      ['Watch for', 'Transfer fee, transfer hook, permanent delegate'],
      ['Where to check', 'The mint configuration on an explorer or token tool']
    ],
    faqs: [
      { q: 'Is Token-2022 less safe than SPL?', a: 'The program itself is audited and widely used. The risk comes from what a specific mint enables — a permanent delegate or a hostile hook changes your position materially, and neither is visible from the symbol.' },
      { q: 'Why did I receive less than I swapped for?', a: 'Most likely a transfer fee extension on that mint. The fee is taken by the token program on every movement and is configured by the mint authority.' },
      { q: 'Can a transfer hook steal my tokens?', a: 'A hook runs logic on transfer and can cause it to fail or enforce conditions. Combined with a permanent delegate, an issuer can have substantial control, which is why those two extensions deserve a direct check.' }
    ]
  }),

  article({
    slug: 'solana-priority-fees',
    cluster: 'solana',
    icon: 'pulse',
    title: 'Solana Priority Fees: The Bid That Gets You Included',
    description:
      'The base fee is tiny and fixed. The priority fee is a per-compute-unit bid that decides whether your transaction lands during congestion.',
    h1: 'Why a Solana transaction fails when the fee is too low',
    intro: [
      'Solana charges a very small fixed base fee per signature. That part is negligible. The part that decides whether your transaction is processed during busy periods is the priority fee you attach.',
      'Setting it badly is the main reason transactions are dropped, and the main reason people conclude the network is down when it is not.'
    ],
    sections: [
      ['How the fee is constructed', [
        'The base fee is a fixed number of lamports per signature. The priority fee is a price per compute unit, multiplied by the compute units your transaction requests, and it is what validators use to order the queue.',
        'Requesting fewer compute units with an accurate limit makes the same priority price cheaper, which is why well-built clients set an explicit compute budget.'
      ]],
      ['What happens when it is too low', [
        'During congestion, transactions below the going rate are not included and eventually expire. There is no mempool holding them indefinitely — they are simply dropped, which is why they vanish rather than staying pending.',
        'This is unlike Ethereum, where an underpriced transaction waits. On Solana it disappears and must be resubmitted.'
      ]],
      ['Estimating a sensible rate', [
        'Clients query recent prioritisation fees for the accounts your transaction touches and set a price above the observed percentile. A popular account under heavy demand requires much more than a quiet one.',
        'Overpaying is cheap in absolute terms, which is why most wallets default to generous estimates during congestion.',
        "Fees are local rather than global. Heavy demand on one popular pool does not raise the price of a transaction touching unrelated accounts, because ordering is computed per account. A network widely described as congested may be entirely quiet for whatever you are doing."
      ]],
      ['What it does not buy', [
        'Inclusion, not success. A swap that fails a slippage check fails identically whatever you paid, and the fee is still consumed.',
        'FBT Swap constructs Solana swaps through public aggregators with a compute budget and priority fee appropriate for current conditions, and shows the quote before your wallet signs.'
      ]]
    ],
    facts: [
      ['Base fee', 'Fixed per signature and negligible'],
      ['Priority fee', 'Price per compute unit; decides ordering'],
      ['Too low', 'The transaction is dropped, not queued'],
      ['Buys', 'Inclusion only — never a successful outcome']
    ],
    faqs: [
      { q: 'Why did my Solana transaction disappear?', a: 'It was most likely not included before its blockhash expired, usually because the priority fee was below the going rate. Solana drops rather than queues, so resubmission with a higher fee is the fix.' },
      { q: 'How much should I pay?', a: 'Enough to clear the current rate for the accounts you are touching, which your wallet or client estimates from recent fees. During heavy demand on a popular pool this can be many times the quiet-period rate.' },
      { q: 'Does a higher fee prevent slippage failures?', a: 'No. It affects whether you are included, not what happens when your transaction runs. A slippage revert consumes the fee regardless.' }
    ]
  }),

  article({
    slug: 'solana-transaction-expiry',
    cluster: 'solana',
    icon: 'history',
    title: 'Why Solana Transactions Expire Instead of Pending',
    description:
      'Each transaction references a recent blockhash valid for a short window. Once it passes, the transaction is permanently invalid. What that changes.',
    h1: 'Solana transactions have a deadline built in',
    intro: [
      'An Ethereum transaction can sit unconfirmed for hours. A Solana transaction cannot: it references a recent blockhash, and once that hash is too old the transaction is rejected permanently.',
      'The window is short — roughly a minute or two. This design prevents replay and removes stuck transactions, and it produces behaviour that surprises people arriving from EVM chains.'
    ],
    sections: [
      ['How the blockhash works', [
        'Every transaction includes a recent blockhash, which validators check against a rolling window of recently produced blocks. If the hash is outside that window, the transaction is invalid and cannot be processed.',
        'This means a signed transaction has a natural expiry and cannot be replayed later, which is a useful security property.'
      ]],
      ['What you see when it expires', [
        'The transaction simply never appears. There is no pending state to cancel and no stuck nonce to clear. Clients report it as expired or not confirmed, and you resubmit.',
        'Nothing was charged, because it was never processed. This is different from an EVM revert, where the fee is consumed.'
      ]],
      ['Why this happens more during congestion', [
        'When demand is high, under-priced transactions are not selected and the window elapses while they wait. The expiry is the visible symptom; the priority fee is usually the cause.',
        'Clients retry by rebuilding with a fresh blockhash and a higher fee rather than resending the same signed payload, which would still be expired.',
        "Durable nonces exist for the cases where a transaction genuinely must be signed in advance and submitted later, such as multisig coordination. They replace the blockhash with a stored value that only advances when used, and they are deliberately uncommon in ordinary flows."
      ]],
      ['What it means for swapping', [
        'A quote and a signature must be close together in time. Leaving a confirmation screen open and signing several minutes later produces an expired transaction rather than a stale trade, which is arguably safer.',
        'FBT Swap builds Solana transactions with a fresh blockhash at signing time and re-quotes before submission, so the common failure is expiry you can retry rather than a bad fill.'
      ]]
    ],
    facts: [
      ['Mechanism', 'A recent blockhash validated against a rolling window'],
      ['Window', 'Short — on the order of a minute or two'],
      ['On expiry', 'Permanently invalid; nothing is charged'],
      ['Usual cause', 'A priority fee too low to be included in time']
    ],
    faqs: [
      { q: 'Can I cancel a Solana transaction?', a: 'There is nothing to cancel. If it is not included within the blockhash window it becomes invalid on its own, which is effectively an automatic cancellation.' },
      { q: 'Was I charged for an expired transaction?', a: 'No. Fees are charged when a transaction is processed. An expired transaction was never processed, so no fee applies.' },
      { q: 'Why does my wallet say "block height exceeded"?', a: 'That is the expiry message: the referenced blockhash fell outside the valid window before inclusion. Rebuild with a fresh blockhash and a higher priority fee.' }
    ]
  }),

  article({
    slug: 'solana-wallet-guide',
    cluster: 'solana',
    icon: 'wallet',
    title: 'Solana Wallets: Different Addresses, Different Rules',
    description:
      'Base58 addresses, no EVM compatibility, token accounts and simulated transaction previews. What to know before funding a Solana wallet.',
    h1: 'A Solana wallet is not an EVM wallet with a different coin',
    intro: [
      'The account model, address format and transaction structure all differ from EVM chains. A wallet that handles both is presenting two genuinely different systems behind one interface.',
      'Four differences account for almost every point of confusion.'
    ],
    sections: [
      ['Addresses and keys', [
        'Solana addresses are base58-encoded public keys, typically thirty-two to forty-four characters, with no prefix. An EVM address is not valid on Solana and cannot be derived into one.',
        'Many wallets derive both from a single seed phrase using different derivation paths, which is why one phrase can produce both an EVM address and a Solana address that look nothing alike.'
      ]],
      ['Accounts rather than balances', [
        'Everything on Solana is an account: your wallet, each token holding, each program, each piece of program state. Transactions must declare which accounts they touch, which is why Solana transactions list many addresses.',
        'This declaration is also what makes parallel execution possible, and it is why a transaction can fail for touching an account another transaction is writing to.',
        "It also means a transaction cannot quietly touch something it did not declare. Everything it can affect is listed before you sign, which is a real structural advantage over an EVM call whose downstream effects are not visible from the calldata alone."
      ]],
      ['Transaction previews are more useful here', [
        'Because accounts are declared up front, wallets can simulate a transaction and show exactly which balances will change before you sign. Good Solana wallets surface this clearly.',
        'Reading that preview is the single most effective safety habit available, and it is better tooling than most EVM wallets offer.'
      ]],
      ['Funding and fees', [
        'Keep a SOL buffer for fees and for the rent deposits new token accounts require. A wallet holding tokens but no SOL cannot transact, and cannot receive a new token type either.',
        'FBT Swap supports Solana alongside sixteen EVM networks, routes through public aggregators, and shows the quote and fee before your wallet signs.'
      ]]
    ],
    facts: [
      ['Address format', 'Base58, no prefix, usually 32–44 characters'],
      ['Account model', 'Transactions declare every account they will touch'],
      ['Best habit', "Read the wallet's simulated balance-change preview"],
      ['Always keep', 'A SOL buffer for fees and token-account rent']
    ],
    faqs: [
      { q: 'Can I use my MetaMask address on Solana?', a: 'No. The formats and key derivation differ, and an EVM address has no meaning on Solana. Use a wallet that supports Solana, which may derive a Solana account from the same seed phrase.' },
      { q: 'Why does a Solana transaction list so many addresses?', a: 'Because every account it reads or writes must be declared in advance. That requirement is what allows the network to execute non-overlapping transactions in parallel.' },
      { q: 'How much SOL should I keep?', a: 'Enough for fees plus rent deposits for the token accounts you expect to open. A small fraction of a SOL covers ordinary use; running to zero makes the wallet unusable until you fund it.' }
    ]
  }),

  article({
    slug: 'jupiter-routing-explained',
    cluster: 'solana',
    icon: 'network',
    title: 'How Solana Swap Routing Finds a Price Across Many Venues',
    description:
      'Solana liquidity is spread across many AMMs and order books. An aggregator compares and splits across them, within one atomic transaction.',
    h1: 'Routing across a fragmented Solana market',
    intro: [
      'Solana has a large number of liquidity venues with very different designs — constant-product pools, concentrated liquidity, stable curves and on-chain order books. No single one holds the market.',
      'An aggregator exists to search across them, and on Solana it can do something EVM routers find expensive: combine several venues inside one atomic transaction.'
    ],
    sections: [
      ['What the router searches', [
        'Direct pools for your pair, and multi-hop paths through intermediate tokens where that produces a better result. It simulates each candidate against live account state and compares the output after fees.',
        'Because Solana transaction fees are low and compute is the binding constraint, more complex routes are economically viable than on an expensive EVM chain.'
      ]],
      ['Splitting and atomicity', [
        'A large order can be divided across several venues so that each portion sits in the shallow part of its curve. All of it executes in one transaction, so either the whole route completes or none of it does.',
        'Atomicity matters: there is no state where half the swap happened and you are holding an unintended intermediate token.'
      ]],
      ['Compute limits as the real constraint', [
        'Each transaction has a compute budget. A route with many hops and venues can exceed it, which causes the transaction to fail. This is why very complex routes sometimes revert while simpler ones succeed.',
        'Clients mitigate by setting an explicit compute limit and by preferring routes that fit comfortably within it.',
        "Account contention is the other constraint. Two transactions writing to the same pool cannot execute in parallel, so a route through a heavily used pool competes for that account. This is why popular routes degrade during activity spikes while obscure ones keep working."
      ]],
      ['What you should still check', [
        'The quote, the price impact and the slippage tolerance, exactly as on any chain. For a Token-2022 mint, check whether a transfer fee applies, because it affects the amount that actually arrives.',
        'FBT Swap routes Solana swaps through public aggregators and shows the route, price impact and fee before your wallet signs.'
      ]]
    ],
    facts: [
      ['Searches', 'Direct and multi-hop paths across many venue types'],
      ['Splits', 'Across venues to reduce price impact, in one transaction'],
      ['Atomic', 'The whole route completes or none of it does'],
      ['Main constraint', 'The per-transaction compute budget, not gas cost']
    ],
    faqs: [
      { q: 'Why did a complex route fail?', a: 'Usually the compute budget. A route touching many venues can exceed the limit, and the transaction fails. A simpler route, or a smaller size, generally succeeds.' },
      { q: 'Is a split route riskier?', a: 'No. It executes atomically within a single transaction, so there is no partial-fill state. The practical risk is the compute limit, not partial execution.' },
      { q: 'Does the aggregator see every venue?', a: 'It covers the venues it integrates, which is most meaningful liquidity but not everything. "Best among queried venues" is the accurate description, as it is on any chain.' }
    ]
  }),

  article({
    slug: 'solana-vs-ethereum-for-swaps',
    cluster: 'solana',
    icon: 'grid',
    title: 'Solana or Ethereum for Swapping: An Honest Comparison',
    description:
      'Fees, finality, liquidity depth, tooling and failure modes differ substantially. Which matters depends entirely on your trade size.',
    h1: 'Two networks, two different trade-offs',
    intro: [
      'Comparisons of these two usually turn into advocacy. The useful version is narrower: for a given swap, which one gives a better result, and why.',
      'The answer flips at a fairly predictable point.'
    ],
    sections: [
      ['Cost and speed', [
        'Solana transaction costs are a tiny fraction of Ethereum mainnet and confirmation is typically sub-second. For small and medium trades this is decisive — fixed cost is close to irrelevant rather than dominant.',
        'Ethereum rollups close much of this gap, which is why the realistic comparison for many users is Solana against a rollup rather than against mainnet.'
      ]],
      ['Liquidity depth', [
        'Ethereum mainnet still holds the deepest pools for many major and long-tail assets, which matters when your order is large enough to walk a curve. Solana has deep liquidity for its own ecosystem and major assets and thinner coverage for some long-tail EVM tokens.',
        'The practical test is the same on both: quote your actual size and read the price impact.'
      ]],
      ['Failure modes differ', [
        'On Ethereum a failed transaction consumes gas. On Solana an under-prioritised transaction expires and costs nothing, but may need several attempts during congestion.',
        'Solana has experienced network-wide degradation historically; Ethereum has experienced sustained fee spikes. Both are real and they affect you differently.',
        "Tooling maturity differs as well. The EVM networks share one account model, one address format and one set of libraries, so a habit learned on one transfers to the next. Solana is its own system, and that knowledge does not carry over in either direction."
      ]],
      ['Choosing per trade', [
        'Small trade, asset available on both: Solana or a rollup, almost always. Large trade in a major EVM asset: depth usually favours Ethereum. Asset native to one ecosystem: trade where it lives.',
        'FBT Swap supports both, plus fifteen other networks, and shows route, price impact and fee for whichever you select so the comparison is a quote rather than an opinion.'
      ]]
    ],
    facts: [
      ['Solana', 'Very low fees, sub-second confirmation, expiry instead of revert'],
      ['Ethereum', 'Highest fees, deepest long-tail liquidity, gas consumed on failure'],
      ['Rollups', 'Close most of the cost gap while keeping EVM tooling'],
      ['Decider', 'Trade size against available depth']
    ],
    faqs: [
      { q: 'Which is cheaper overall?', a: 'Solana is dramatically cheaper per transaction than Ethereum mainnet and comparable to or cheaper than rollups. For large trades, price impact can outweigh all of that.' },
      { q: 'Is Solana less reliable?', a: 'It has had network-wide incidents historically and has improved substantially. Ethereum has not had comparable outages but has had periods where fees made it unusable for small trades. Both are real limitations.' },
      { q: 'Can I move assets between them?', a: 'Only through a bridge, with its own cost and risk. The same asset on each chain is a different token, and the bridged version carries the bridge\'s risk as well as its own.' }
    ]
  }),

  article({
    slug: 'solana-scam-tokens',
    cluster: 'solana',
    icon: 'alert',
    title: 'Solana Scam Tokens: Cheap to Deploy, Easy to Dress Up',
    description:
      'Low fees make mass token creation trivial. Mint authority, freeze authority, LP burn status and metadata are the checks that matter.',
    h1: 'Four checks before buying any Solana token',
    intro: [
      'Deploying a token on Solana costs very little, which is good for builders and good for anyone running a volume scam. The result is an enormous number of mints, most of which are not projects.',
      'Four pieces of on-chain configuration separate a token you can hold from one you cannot.'
    ],
    sections: [
      ['Mint authority', [
        'If the mint authority is still set, whoever holds it can create unlimited new supply at any time and sell it into the pool. A revoked mint authority means supply is fixed.',
        'This is visible on the mint account and on every explorer. An active mint authority on a token promoted as having a fixed supply is a direct contradiction.'
      ]],
      ['Freeze authority', [
        'A freeze authority can freeze any token account, which means your balance can be made untransferable. Legitimate uses exist for regulated assets; for an ordinary token it is a loss of control.',
        'Revoked freeze authority is the expected configuration for a token meant to trade freely.'
      ]],
      ['Liquidity pool ownership', [
        'If the deployer holds the LP position, they can withdraw it and the token becomes untradeable instantly. Burned or locked LP removes that specific risk, and the burn transaction is verifiable on-chain.',
        'Check the actual transaction rather than a claim in a social post.',
        "Locking is not the same as burning. A time-locked position returns to the deployer when the lock expires, and that expiry date is public and worth reading. A lock measured in days is a countdown rather than a commitment."
      ]],
      ['Metadata and Token-2022 extensions', [
        'Metadata can be mutable, meaning name, symbol and image can be changed after you buy. For a Token-2022 mint, check for a transfer fee, a transfer hook or a permanent delegate — the last of which allows an authority to move your tokens.',
        'FBT Swap routes Solana swaps through public aggregators and shows the quote and fee. It does not vet tokens, so for anything selected by mint address these four checks are yours to run.'
      ]]
    ],
    howTo: [
      ['Open the mint on an explorer', 'Paste the mint address and look at the account configuration rather than the token page branding.'],
      ['Check mint authority', 'Revoked means fixed supply. Still set means unlimited new supply is possible at any moment.'],
      ['Check freeze authority', 'Revoked means your balance cannot be frozen. Still set means it can.'],
      ['Check the liquidity', 'Verify whether the LP position is burned or locked, using the on-chain transaction rather than a claim.'],
      ['Check extensions and metadata', 'Look for transfer fee, transfer hook, permanent delegate and whether metadata is mutable.']
    ],
    facts: [
      ['Mint authority', 'If set, supply can be increased without limit'],
      ['Freeze authority', 'If set, your balance can be made untransferable'],
      ['LP status', 'Burned or locked, verified on-chain — not from a social post'],
      ['Token-2022', 'Check transfer fee, hook and permanent delegate']
    ],
    faqs: [
      { q: 'Does revoked mint authority make a token safe?', a: 'It removes one specific risk — unlimited supply inflation. It says nothing about liquidity being pulled, metadata changing, or the project having any substance.' },
      { q: 'Why can I buy but not sell?', a: 'On Solana the usual causes are a frozen token account, a Token-2022 transfer hook blocking the route, or liquidity having been removed. All three are visible on-chain.' },
      { q: 'Are tokens in a wallet list pre-screened?', a: 'Appearing in a searchable list usually means the mint exists and has some liquidity. It is not a safety assessment, and tokens selected by address are entirely your own verification.' }
    ]
  })
];
