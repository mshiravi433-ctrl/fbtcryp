/** CLUSTER: DeFi yield & lending — 12 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'defi-lending-explained',
    cluster: 'defi',
    icon: 'receipt',
    title: 'How DeFi Lending Works and Who Pays the Interest',
    description:
      'Suppliers deposit into a pool, borrowers post collateral and pay interest, and a rate curve balances the two. No credit checks, no maturity dates.',
    h1: 'DeFi lending: a pool, a rate curve and collateral',
    intro: [
      'There is no lender and borrower matched by a person. There is a pool of a single asset, suppliers who add to it, borrowers who take from it against collateral they posted, and an interest rate that moves with how much of the pool is in use.',
      'Every yield figure you see on a lending screen comes from borrowers paying for capital. If you cannot see who is borrowing and why, you are looking at something other than lending yield.'
    ],
    sections: [
      ['The utilisation curve', [
        'Rates are a function of utilisation — the share of the pool currently borrowed. At low utilisation borrowing is cheap to attract demand. Past a target point the rate rises steeply, which pushes borrowers to repay and suppliers to deposit, keeping some liquidity available for withdrawals.',
        'This is why supply rates move constantly without anybody setting them, and why a high advertised rate often means the pool is nearly fully borrowed.'
      ]],
      ['Collateral instead of credit', [
        'Loans are overcollateralised: you post more value than you borrow. There is no identity, no credit score and no repayment schedule. The protocol does not need to trust you because it can sell your collateral if the position becomes unsafe.',
        'That is also the whole risk for a borrower. Price moves against your collateral and the position is liquidated automatically.'
      ]],
      ['What a supplier is actually exposed to', [
        'Smart contract failure, oracle manipulation, a collateral asset collapsing faster than liquidators can act, and liquidity risk — if utilisation hits the ceiling you cannot withdraw until borrowers repay or new deposits arrive.',
        'The interest is real. So is each of those, and the rate is the compensation for them.'
      ]],
      ['Reading a rate before accepting it', [
        'Check whether the headline figure is base interest or includes token incentives, which can stop at any time. Check utilisation, the collateral assets accepted, and the oracle the protocol uses. Check whether the rate shown is current or a trailing average.',
        'FBT Swap surfaces lending data from the protocols themselves with their source, and shows an unavailable state rather than an invented number when a source is down. No figure shown anywhere is a promised return.'
      ]]
    ],
    facts: [
      ['Who pays', 'Borrowers, through interest set by a utilisation curve'],
      ['Collateral', 'Overcollateralised; no identity or credit assessment'],
      ['Supplier risks', 'Contract, oracle, collateral quality and withdrawal liquidity'],
      ['Headline rates', 'Often include incentives that can stop without notice']
    ],
    faqs: [
      { q: 'Can I lose money supplying to a lending pool?', a: 'Yes. A contract exploit, an oracle failure or a collateral asset collapsing can leave the pool with bad debt, and depositors absorb it. The interest rate exists because these risks exist.' },
      { q: 'Why can I not withdraw my deposit?', a: 'Because utilisation is at or near the maximum and the assets are lent out. Withdrawals resume as borrowers repay or new supply arrives, and the rising rate is the mechanism pushing that to happen.' },
      { q: 'Is a higher rate better?', a: 'A higher rate is compensation for something. Usually high utilisation, a riskier asset, or temporary incentives. Treating it as free is the single most common error on a yield screen.' }
    ]
  }),

  article({
    slug: 'loan-to-value-and-health-factor',
    cluster: 'defi',
    icon: 'pulse',
    title: 'Loan-to-Value and Health Factor: Reading Your Liquidation Risk',
    description:
      'LTV is how much you borrowed against your collateral. Health factor is how far you are from liquidation. How both move and what to target.',
    h1: 'The two numbers that decide whether you get liquidated',
    intro: [
      'Every collateralised borrowing position has a ratio describing how much you owe against what you posted, and a derived figure telling you how close that is to the liquidation threshold.',
      'They move on their own, because they are functions of prices you do not control. Understanding how far they can move before anything happens is the whole job of managing a position.'
    ],
    sections: [
      ['How loan-to-value is calculated', [
        'LTV is the value of your debt divided by the value of your collateral. Each collateral asset has a maximum LTV the protocol will allow at borrow time, and a higher liquidation threshold at which it will act.',
        'The gap between those two is your working room. A 75% maximum with an 80% liquidation threshold gives you much less room than the numbers suggest, because both move with price.'
      ]],
      ['What health factor adds', [
        'Health factor expresses the same thing as a single number where one is the liquidation point. Above one you are safe; at or below one your collateral can be sold.',
        'It is more useful than LTV because it already weights each collateral asset by its own threshold, so a mixed-collateral position has one number to watch.'
      ]],
      ['How it moves without you doing anything', [
        'Collateral price falling raises LTV. Borrowed asset price rising raises LTV. Interest accruing on the debt raises LTV slowly and continuously. A protocol lowering a threshold for a risky asset raises it instantly.',
        'Borrowing a volatile asset against volatile collateral means both ends move at once, which is why those positions liquidate on moves that look modest.'
      ]],
      ['Practical targets', [
        'Borrowing near the maximum leaves no room for ordinary volatility. Many borrowers target a health factor well above the minimum and top up collateral or repay before it approaches it.',
        'FBT Swap shows live position health where the protocol exposes it, with the data source named. It cannot prevent liquidation and does not promise to warn in time — the position is yours and the market does not wait.'
      ]]
    ],
    facts: [
      ['LTV', 'Debt value divided by collateral value'],
      ['Health factor', 'A single number; one is the liquidation point'],
      ['Moves from', 'Collateral price, debt price, accrued interest, parameter changes'],
      ['Safe practice', 'A wide margin, not the maximum the protocol allows']
    ],
    faqs: [
      { q: 'What health factor is safe?', a: 'There is no universally safe number — it depends on how volatile your collateral and debt are. A stable-collateral, stable-debt position tolerates a much tighter factor than a volatile pair.' },
      { q: 'Does repaying part of a loan help immediately?', a: 'Yes. Repaying reduces debt and raises the health factor straight away, as does adding collateral. Both are the standard responses to a falling factor.' },
      { q: 'Will I be warned before liquidation?', a: 'Not reliably. Notifications depend on your device, connectivity and the data source being available, and prices can move faster than any alert. Treat monitoring as your responsibility.' }
    ]
  }),

  article({
    slug: 'liquidation-in-defi',
    cluster: 'defi',
    icon: 'alert',
    title: 'What Happens During a DeFi Liquidation',
    description:
      'When health falls below one, liquidators repay your debt and take collateral plus a bonus. The mechanics, the cost to you, and cascade risk.',
    h1: 'Liquidation, step by step and at your expense',
    intro: [
      'Liquidation is not a penalty imposed by a company. It is an open invitation: the protocol offers anyone the right to repay part of your debt in exchange for your collateral at a discount.',
      'That discount is the liquidator\'s profit and your loss, and it is the reason positions should never be run close to the threshold.'
    ],
    sections: [
      ['The trigger', [
        'An oracle reports a price that pushes your health factor to or below one. From that moment the position is eligible, and bots monitoring every position on the protocol compete to act on it within seconds.',
        'There is no grace period and no human review. The speed is a feature — slow liquidation is how a protocol ends up with bad debt.'
      ]],
      ['The transaction', [
        'A liquidator repays a portion of your debt and receives an equivalent value of your collateral plus a bonus, typically a few percent. Your debt falls, your collateral falls by more, and your health factor improves.',
        'Many protocols cap how much can be liquidated at once, so a position may be partially liquidated several times as the price continues to move.'
      ]],
      ['What it costs you', [
        'The bonus, which is pure loss. Any protocol liquidation fee on top. And the fact that you sold collateral at the worst available moment, which is exactly when prices are falling.',
        'A liquidation during a sharp move frequently costs more than the loss that caused it.'
      ]],
      ['Cascades and why they matter', [
        'Liquidations sell collateral into a falling market, pushing the price lower, which triggers more liquidations. During a cascade, oracle updates lag, gas spikes, and the ability to add collateral in time disappears.',
        'The defence is structural rather than reactive: maintain a margin wide enough that an ordinary bad day does not reach your threshold, because during a cascade you will not be able to act.'
      ]]
    ],
    facts: [
      ['Trigger', 'Health factor at or below one, per the protocol oracle'],
      ['Who acts', 'Anyone — competitive bots, within seconds'],
      ['Your cost', 'The liquidation bonus plus any protocol fee, plus a forced sale'],
      ['Cascade', 'Liquidations push prices down and trigger more liquidations']
    ],
    faqs: [
      { q: 'Can I stop a liquidation once it starts?', a: 'Only by raising the health factor above one before someone acts, which during volatility means seconds. Repaying debt or adding collateral both work, if the transaction confirms in time.' },
      { q: 'Do I lose all my collateral?', a: 'Usually not. Most protocols liquidate only part of the position at a time, so you keep the remainder — minus the bonus taken on what was sold. Repeated liquidations can still consume most of it.' },
      { q: 'Does FBT Swap liquidate positions?', a: 'No. Liquidation is performed by the lending protocol and third-party liquidators on-chain. FBT Swap displays position health where the protocol exposes it and never holds your collateral.' }
    ]
  }),

  article({
    slug: 'impermanent-loss-explained',
    cluster: 'defi',
    icon: 'chart',
    title: 'Impermanent Loss: The Cost of Being a Market Maker',
    description:
      'A pool rebalances against you as prices diverge. Why the loss is real, why the name is misleading, and when fees genuinely outweigh it.',
    h1: 'The loss that is only impermanent if the price comes back',
    intro: [
      'When you provide liquidity to a pool, the pool sells the asset that is rising and buys the one that is falling, automatically and continuously. The result is that you end up with less value than if you had simply held both tokens.',
      'The name suggests it reverses. It does, if prices return to where you started. If you withdraw at any other point, the loss is entirely permanent.'
    ],
    sections: [
      ['Why it happens mechanically', [
        'A constant-product pool keeps the product of its reserves fixed. When an external price moves, arbitrageurs trade against the pool until its price matches, and the pool\'s composition shifts toward the asset that fell.',
        'You own a share of the pool, so you own that shifted composition. Nobody took anything from you; the pool did exactly what it is designed to do.'
      ]],
      ['The size of it', [
        'Divergence loss grows with the ratio of price change. A modest move produces a small loss; a large divergence produces a substantial one. It is symmetric — the direction does not matter, only the magnitude of the change in ratio.',
        'This is why two assets that move together, such as two dollar stablecoins or two forms of the same asset, produce very little of it.'
      ]],
      ['When fees win', [
        'Fees accrue continuously from volume. A pair with high volume relative to its volatility can earn more in fees than it loses to divergence. A pair with low volume and high volatility will not.',
        'Any yield figure that presents fee income without the divergence comparison is incomplete, which is most of them.'
      ]],
      ['Concentrated liquidity makes both bigger', [
        'Providing within a narrow price range multiplies your fee income while the price stays inside it, and multiplies divergence loss when it moves. Outside the range you hold a single asset and earn nothing.',
        'It is a more active strategy than it appears, and treating it as passive income is how people discover the mechanism the hard way.'
      ]]
    ],
    facts: [
      ['Cause', 'The pool rebalances toward the falling asset as prices diverge'],
      ['Permanent when', 'You withdraw at any ratio other than your entry ratio'],
      ['Smallest for', 'Pairs that move together, such as two dollar stablecoins'],
      ['Concentrated liquidity', 'Amplifies both fee income and divergence loss']
    ],
    faqs: [
      { q: 'Does impermanent loss mean I lose money overall?', a: 'Not necessarily. It means you have less than if you had held. Fee income can exceed it, and the only honest comparison is total position value against simply holding both tokens.' },
      { q: 'Can I avoid it entirely?', a: 'Only by not providing liquidity to a volatile pair. Correlated pairs minimise it, and single-sided products usually transfer the exposure rather than removing it.' },
      { q: 'How do I measure it?', a: 'Compare your position\'s current total value, including claimed fees, against the value of the original token amounts had you never deposited. The difference is the net result.' }
    ]
  }),

  article({
    slug: 'apy-vs-apr-in-defi',
    cluster: 'defi',
    icon: 'receipt',
    title: 'APY vs APR: Why Two Honest Numbers Differ So Much',
    description:
      'APR is the simple rate. APY assumes compounding. Protocols quote different ones, and a dollar APY on a volatile asset is not dollar income.',
    h1: 'Reading a yield number without being misled',
    intro: [
      'Two protocols can offer identical economics and display very different headline numbers, purely through which convention they use and what they include.',
      'Three distinctions cover almost every confusion: simple versus compounded, base versus incentivised, and denominated in the asset versus denominated in dollars.'
    ],
    sections: [
      ['Simple versus compounded', [
        'APR is the nominal annual rate without compounding. APY assumes earnings are reinvested at some frequency. At low rates the difference is small; at high rates it is large, and a protocol compounding every block produces a dramatically higher APY from the same APR.',
        'Neither is dishonest. Comparing one protocol\'s APY to another\'s APR is.'
      ]],
      ['Base rate versus incentives', [
        'A displayed rate often combines interest actually paid by borrowers with a distribution of the protocol\'s own token. The first is sustained by demand; the second is a marketing budget with an end date.',
        'Token incentives also carry price risk — a rate quoted in a token that falls fifty percent was not the rate you earned.'
      ]],
      ['Denomination is the biggest trap', [
        'An APY shown in dollars on a volatile asset is a conversion of a yield paid in that asset. If you supply ETH at 3% and ETH falls 20%, you have more ETH and less money. The percentage was accurate and told you nothing about your dollar outcome.',
        'This is the single most common misreading on any yield screen, and it is why a dollar-denominated figure on a non-dollar asset deserves a second look.'
      ]],
      ['Making a fair comparison', [
        'Convert everything to the same convention, separate base from incentives, note the denomination, and check whether the figure is current, trailing or projected. Then ask who pays it and whether that payer will still be there next month.',
        'FBT Swap shows yield figures with their source and does not present any of them as guaranteed. Where a source is unavailable, it shows that rather than an estimate.'
      ]]
    ],
    facts: [
      ['APR', 'Simple annual rate, no compounding assumed'],
      ['APY', 'Assumes reinvestment; higher for the same underlying rate'],
      ['Incentives', 'Token distributions that can stop and can fall in value'],
      ['Denomination', 'A dollar APY on a volatile asset is not dollar income']
    ],
    faqs: [
      { q: 'Which number should I compare across protocols?', a: 'Whichever you can compute consistently for both — usually base APR excluding incentives, then consider incentives separately with their own risk.' },
      { q: 'Is a 40% APY realistic?', a: 'It can be arithmetically real and still unsustainable. Ask who is paying it: if the answer is a token emission rather than borrower demand or trading volume, the rate has a shelf life.' },
      { q: 'Why did my actual return differ from the displayed APY?', a: 'Rates change continuously with utilisation, incentives change, compounding may not happen automatically, and asset prices move. A displayed rate is a snapshot annualised, not a forecast of your outcome.' }
    ]
  }),

  article({
    slug: 'liquid-staking-tokens',
    cluster: 'defi',
    icon: 'leaf',
    title: 'Liquid Staking Tokens: Staked ETH You Can Still Use',
    description:
      'A liquid staking token represents staked capital plus rewards. Rebasing versus value-accruing, the discount risk, and the layers you are trusting.',
    h1: 'What a liquid staking token actually represents',
    intro: [
      'Staking locks capital to secure a chain and earns a reward. A liquid staking token is a claim on that locked position which you can hold, trade or use as collateral while it remains staked.',
      'It is genuinely useful and it adds layers: the staking protocol, its validator set, its withdrawal mechanism, and the market price of the token itself.'
    ],
    sections: [
      ['Rebasing versus value-accruing', [
        'A rebasing token increases your balance over time while staying near a one-to-one price with the underlying. A value-accruing token keeps your balance fixed while the token itself becomes worth progressively more than the underlying.',
        'The economics are equivalent; the integration behaviour is not. Many protocols cannot handle rebasing balances, which is why wrapped value-accruing versions exist.'
      ]],
      ['Why the market price can drift', [
        'The token should trade close to the value of the staked position plus rewards. When withdrawals are slow or confidence drops, it can trade below — a discount that reflects liquidity and trust rather than the underlying being impaired.',
        'That discount is a real risk if you need to exit immediately, and a real opportunity if you do not.'
      ]],
      ['Risks that are additional, not replacements', [
        'Validator slashing reduces the underlying. A bug in the staking contract can affect the whole position. Governance decisions change parameters. And using the token as collateral stacks lending liquidation risk on top of all of it.',
        'Each layer is small on its own; the combination is what deserves attention.'
      ]],
      ['Using them sensibly', [
        'Understand whether your token rebases before integrating it anywhere. Check withdrawal mechanics and typical queue times. If you use it as collateral, remember that a discount event moves your health factor without the underlying asset moving at all.',
        'FBT Swap supports swapping major liquid staking tokens on the networks where they have liquidity, with the price impact shown for your size.'
      ]]
    ],
    facts: [
      ['Represents', 'A staked position plus accrued rewards'],
      ['Two forms', 'Rebasing balance or value-accruing price'],
      ['Discount risk', 'Can trade below the underlying when exits are slow'],
      ['Stacked risk', 'Staking plus contract plus governance plus collateral use']
    ],
    faqs: [
      { q: 'Is a liquid staking token the same as the underlying asset?', a: 'No. It is a claim on a staked position, priced by a market. It usually tracks closely and can trade at a discount when confidence or liquidity drops.' },
      { q: 'What happens if validators are slashed?', a: 'The underlying staked balance falls, so the token\'s backing falls. Large staking protocols distribute this across all holders and some maintain insurance arrangements, which vary by protocol.' },
      { q: 'Can I unstake instantly?', a: 'Usually not through the protocol — withdrawals have a queue. Selling on the open market is the instant route, and that is where the discount shows up.' }
    ]
  }),

  article({
    slug: 'yield-farming-risks',
    cluster: 'defi',
    icon: 'alert',
    title: 'Yield Farming Risks, Named One by One',
    description:
      'Contract risk, incentive decay, impermanent loss, token price collapse, oracle failure and exit liquidity. What each looks like in practice.',
    h1: 'Six ways a farming position loses money',
    intro: [
      'Farming yields are not imaginary — the fees and emissions are real. The returns people actually realise are often far below the advertised rate because several costs are not in the headline number.',
      'These are the six, in roughly the order they catch people.'
    ],
    sections: [
      ['Incentive decay and reward token price', [
        'A high rate funded by token emissions falls as more capital arrives, because the same emission is split further. Simultaneously, farmers selling the reward token push its price down, which reduces the rate again in dollar terms.',
        'The quoted number on day one is rarely the number anyone receives by week four.'
      ]],
      ['Impermanent loss on the position itself', [
        'Most farms require a liquidity position, which carries divergence loss. On a volatile pair this can exceed the entire reward, and it is denominated separately from the yield so it never appears in the rate.',
        'Correlated pairs reduce it; pairing a volatile token against a stablecoin maximises it.'
      ]],
      ['Contract and oracle risk', [
        'You are interacting with the pool contract, the farm contract, often a vault wrapper, and whatever oracle they rely on. Each is a separate piece of code that can fail, and complexity compounds rather than averages.',
        'Audits reduce the chance of certain bugs within a scope and do not make this risk zero.',
        "Stacked positions multiply this. Depositing into a vault that deposits into a protocol that borrows from a third means three contracts must all behave, and a failure anywhere unwinds the whole position. The advertised rate rarely mentions how many layers produced it."
      ]],
      ['Exit liquidity and gas drag', [
        'Rewards are only worth the price at which you can actually sell them. A thin reward token means your exit moves the price against you, sometimes substantially.',
        'Frequent compounding on an expensive chain also quietly consumes a meaningful share of the yield. FBT Swap shows farm and yield data with its source and never presents any of it as guaranteed income.'
      ]]
    ],
    facts: [
      ['Incentive decay', 'Rate falls as capital arrives and as reward tokens are sold'],
      ['Divergence loss', 'Priced separately from yield; can exceed the rewards'],
      ['Stacked contracts', 'Pool, farm, vault and oracle are four distinct risks'],
      ['Exit', 'A thin reward token means selling moves the price against you']
    ],
    faqs: [
      { q: 'Is any farming yield sustainable?', a: 'Yield from genuine trading fees or borrower interest can be, because there is a payer with a reason to pay. Yield from token emissions is a distribution with a budget, and budgets end.' },
      { q: 'How do I estimate a realistic return?', a: 'Start from the base fee or interest component, treat emissions at a discount for price decay, subtract expected divergence loss for the pair, and subtract gas for entry, compounding and exit.' },
      { q: 'Does a high TVL farm mean it is safe?', a: 'No. Large deposits indicate popularity, not security, and several of the biggest losses in DeFi happened in protocols with very large balances at the time.' }
    ]
  }),

  article({
    slug: 'stablecoin-yield-sources',
    cluster: 'defi',
    icon: 'key',
    title: 'Where Stablecoin Yield Comes From — and When It Does Not',
    description:
      'Lending interest, treasury income, trading fees and incentives are the four real sources. Anything else is paying you from deposits.',
    h1: 'Four legitimate sources of stablecoin yield',
    intro: [
      'A dollar-denominated return has to be paid by somebody. There are four common sources and they have very different risk and sustainability profiles.',
      'If a product cannot be mapped onto one of them, the sensible assumption is that new deposits are paying existing depositors.'
    ],
    sections: [
      ['Borrower interest', [
        'The most straightforward source: people borrowing stablecoins against collateral pay interest, and suppliers receive it. The rate moves with demand for leverage, which is why it rises in bull markets and falls in quiet ones.',
        'Risk is contract failure, oracle failure, and bad debt if collateral collapses faster than liquidations can clear.'
      ]],
      ['Treasury and real-world income', [
        'Some stablecoin issuers and tokenised products pass through income from short-term government debt. This is genuine external yield and is bounded by prevailing interest rates — a product offering several times that is not doing this.',
        "The gap between a product rate and its underlying source rate is the first thing worth computing. If treasury yield is four percent and the product pays twelve, eight points are coming from somewhere else, and that somewhere else is either leverage, incentives, or risk nobody has named.",
        'Risk is issuer and custody risk, redemption mechanics, and whatever legal structure holds the assets.'
      ]],
      ['Trading fees', [
        'Providing liquidity to stable pairs earns fees from swap volume with minimal divergence loss, since the assets track each other. Returns are modest and depend entirely on volume.',
        'Risk is contract failure and the possibility that one of the stablecoins loses its peg, at which point the pool fills with the broken one.'
      ]],
      ['Incentives — and the thing to be suspicious of', [
        'Protocols distribute their own token to attract deposits. This is real income while it lasts and is not a yield on the underlying activity.',
        'The pattern to avoid is a fixed high dollar rate with no identifiable payer. FBT Swap shows lending and yield figures with their source and never displays a fixed or guaranteed rate, because no such thing exists on-chain.'
      ]]
    ],
    facts: [
      ['Borrower interest', 'Sustainable while leverage demand exists; rate floats'],
      ['Treasury income', 'Bounded by prevailing short-term rates'],
      ['Trading fees', 'Modest, volume-dependent, low divergence on stable pairs'],
      ['Warning sign', 'A fixed high rate with no identifiable payer']
    ],
    faqs: [
      { q: 'Is stablecoin yield risk-free?', a: 'No. The asset is stable; the yield is not risk-free. Contract failure, depeg of the stablecoin itself, and bad debt in a lending pool are all live risks regardless of the dollar denomination.' },
      { q: 'What is a plausible rate?', a: 'Rates broadly track demand for leverage and prevailing short-term interest rates. Something far above both is being paid by incentives or by something that is not sustainable.' },
      { q: 'Does FBT Swap offer a fixed stablecoin return?', a: 'No. There is no fixed or guaranteed rate anywhere in the app. Figures come from the underlying protocols with their source shown, and they change.' }
    ]
  }),

  article({
    slug: 'concentrated-liquidity-explained',
    cluster: 'defi',
    icon: 'layers',
    title: 'Concentrated Liquidity: Higher Fees, Active Management',
    description:
      'Providing in a price range multiplies capital efficiency and divergence loss together. Why range selection is the whole strategy.',
    h1: 'A range instead of a curve',
    intro: [
      'Classic liquidity provision spreads your capital across every possible price, most of which will never occur. Concentrated liquidity lets you place it in a range you choose, so the capital that is actually used is far larger relative to what you deposited.',
      'The upside is proportionally more fees. The downside is that everything else scales with it too.'
    ],
    sections: [
      ['Why efficiency rises', [
        'If you provide between two prices rather than from zero to infinity, your capital backs the pool only within that band. Inside it, you behave as though you had deposited many times more, so you capture a proportionally larger share of the fees.',
        'Narrower ranges produce larger multipliers, which is the whole attraction.'
      ]],
      ['What happens at the edges', [
        'When the price leaves your range, your position converts entirely into whichever asset is now on the wrong side, and you stop earning fees altogether. You are holding a single token and waiting.',
        'If the price never returns, you have effectively sold one asset for the other across your range — realised, not impermanent.'
      ]],
      ['Range selection is the strategy', [
        'A tight range earns much more while it holds and exits quickly. A wide range earns less and survives more. Rebalancing to follow the price costs gas and realises the loss each time you do it.',
        'This makes it an active position with a running cost, which is very different from how it is often described.'
      ]],
      ['Who it suits', [
        'It suits correlated pairs where the price genuinely stays in a band, and participants willing to monitor and adjust. It suits volatile pairs and passive holders much less well, despite the headline yields being highest there.',
        'FBT Swap surfaces liquidity and pool data from the underlying protocols with their source shown, and presents none of it as a promised return.'
      ]]
    ],
    facts: [
      ['Mechanism', 'Liquidity placed in a chosen price band'],
      ['Gain', 'Far higher fee capture per unit of capital inside the range'],
      ['Cost', 'Divergence loss scales up; zero fees outside the range'],
      ['Reality', 'An active position with gas costs, not passive income']
    ],
    faqs: [
      { q: 'What happens when the price exits my range?', a: 'Your position becomes entirely the asset the market moved away from, and you earn no fees until the price comes back or you rebalance into a new range.' },
      { q: 'How tight should a range be?', a: 'Tighter means more fees and shorter survival. The right width depends on the pair\'s volatility and how often you are willing to rebalance, since each rebalance costs gas and realises the position.' },
      { q: 'Is it better than classic liquidity provision?', a: 'It is more capital efficient and more demanding. For a correlated pair with active management it usually wins; for a volatile pair left alone it frequently does worse.' }
    ]
  }),

  article({
    slug: 'defi-protocol-audit-reading',
    cluster: 'defi',
    icon: 'book',
    title: 'How to Read a DeFi Audit Report Properly',
    description:
      'Scope, commit hash, severity counts and resolution status matter more than the auditor logo. What an audit never covers.',
    h1: 'An audit is a document, not a guarantee',
    intro: [
      '"Audited" has become a badge rather than a claim about anything specific. A useful reading takes a few minutes and answers a different question: what exactly was examined, when, and what was found.',
      'The answers are frequently narrower than the badge implies.'
    ],
    sections: [
      ['Scope and commit hash', [
        'An audit covers specific files at a specific commit. If the deployed contract differs from that commit, the audit does not describe what is live. Check the hash in the report against the deployed, verified source.',
        'Scope exclusions matter too. Reports routinely state that economic design, oracle reliability or dependencies were out of scope, and those are often where the real risk is.'
      ]],
      ['Findings and what happened to them', [
        'Count findings by severity and check the resolution status of each. Acknowledged is not fixed — it means the team read it and chose to accept it. A high-severity acknowledged finding is a decision you are now inheriting.',
        'Zero findings on a complex protocol usually means a narrow scope rather than perfect code.'
      ]],
      ['What audits never cover', [
        'Governance decisions, admin key behaviour, incentive design, oracle manipulation under extreme conditions, and every contract the audited one interacts with. Also every change made after the report date.',
        "A report is a snapshot of one commit. Protocols ship upgrades, add collateral types and adjust parameters continuously, and none of that is covered by a document written months earlier. The useful question is what has changed since, not whether an audit exists at all.",
        'Most large DeFi losses involved code that had been audited, because the failures were in these categories.'
      ]],
      ['Better signals than an audit badge', [
        'Time in production with significant value at stake. An active bug bounty with meaningful payouts. Timelocked governance so changes are visible before they take effect. Multiple independent reviews rather than one.',
        'FBT Swap routes through established public aggregators and does not operate its own lending or pool contracts. Protocol risk belongs to the protocol, and the app names the source of the data it displays.'
      ]]
    ],
    facts: [
      ['Check first', 'The commit hash against the deployed, verified source'],
      ['Check second', 'Scope exclusions — often where the real risk sits'],
      ['Acknowledged', 'Means accepted, not fixed'],
      ['Never covered', 'Governance, admin keys, economics, and later changes']
    ],
    faqs: [
      { q: 'Does a well-known auditor mean better security?', a: 'Reputation correlates with thoroughness but does not change the fundamental limits. The scope, the commit and the resolution status tell you more than the name on the cover.' },
      { q: 'Is an unaudited protocol always unsafe?', a: 'It carries a higher unknown. Some unaudited code is simple and widely reviewed; some audited code is complex and barely understood. Audit status is one input, not a verdict.' },
      { q: 'What is a bug bounty worth as a signal?', a: 'A large, actively paid bounty is a strong signal, because it puts a continuous market price on finding flaws. A token bounty with a low cap signals the opposite.' }
    ]
  }),

  article({
    slug: 'collateral-types-and-risk',
    cluster: 'defi',
    icon: 'shield',
    title: 'Choosing Collateral: Not All Assets Carry the Same Risk',
    description:
      'Volatility, liquidity, oracle quality and correlation with your debt decide how safe collateral is. Why the protocol parameters tell you this.',
    h1: 'What makes one collateral asset safer than another',
    intro: [
      'A lending protocol assigns different parameters to each accepted asset: maximum loan-to-value, liquidation threshold, liquidation bonus and supply caps. Those numbers are the protocol\'s own risk assessment, written down.',
      'Reading them tells you more about an asset\'s risk than any description does.'
    ],
    sections: [
      ['Volatility and liquidity', [
        'An asset that moves sharply needs a wider buffer, which is why it receives a lower maximum LTV. An asset with thin liquidity is dangerous even if it is not volatile, because liquidators cannot sell it quickly without moving the price.',
        'Low LTV plus a high liquidation bonus plus a tight supply cap is the protocol telling you it considers an asset risky.'
      ]],
      ['Oracle quality', [
        'Collateral is only as reliable as the price feed valuing it. A thinly traded asset with a manipulable feed has been the basis of multiple protocol exploits, where an attacker moved a price to borrow against inflated collateral.',
        'Check which oracle is used and whether the asset has deep enough markets for that oracle to be hard to move.'
      ]],
      ['Correlation with your debt', [
        'Borrowing an asset that moves with your collateral is much safer than borrowing one that moves against it. Stablecoin debt against volatile collateral means only one side moves; volatile debt against volatile collateral means both.',
        'The worst configuration is borrowing an asset that tends to rise exactly when your collateral falls, which is a liquidation engine.'
      ]],
      ['Wrapped and derivative collateral', [
        'Liquid staking tokens, bridged assets and wrapped versions all add a layer between the collateral and the thing it represents. A discount event in that layer moves your health factor with no movement in the underlying.',
        'FBT Swap shows live position health where the protocol exposes it, with the data source named, and never guarantees a liquidation warning will arrive in time.'
      ]]
    ],
    facts: [
      ['Read the parameters', 'Max LTV, liquidation threshold, bonus and supply caps'],
      ['Thin liquidity', 'Dangerous even without volatility — liquidators cannot exit'],
      ['Oracle', 'Manipulable feeds have caused multiple protocol exploits'],
      ['Worst pairing', 'Debt that rises when your collateral falls']
    ],
    faqs: [
      { q: 'Is a stablecoin always the safest collateral?', a: 'It removes price volatility, which is the main driver of liquidation, and it introduces depeg risk and issuer risk. Safer in the usual case, not risk-free.' },
      { q: 'Why does the protocol limit how much of an asset it accepts?', a: 'Supply caps limit the protocol\'s total exposure to one asset failing, and they prevent an attacker accumulating enough collateral to make manipulation worthwhile.' },
      { q: 'Can collateral parameters change?', a: 'Yes, through governance, and sometimes quickly during stress. A threshold being lowered raises your LTV instantly without any price movement at all.' }
    ]
  }),

  article({
    slug: 'borrowing-against-crypto',
    cluster: 'defi',
    icon: 'wallet',
    title: 'Borrowing Against Crypto: Reasons, Costs and the Trap',
    description:
      'A loan against collateral avoids selling but adds liquidation risk and ongoing interest. When it makes sense and when it quietly does not.',
    h1: 'Borrowing instead of selling: the real trade',
    intro: [
      'Taking a loan against crypto looks like a way to access value without giving up the asset. That is accurate, and the cost is that you have replaced a decision with an ongoing obligation that the market can call in.',
      'Whether it is sensible depends almost entirely on what you do with the borrowed funds and how much margin you leave.'
    ],
    sections: [
      ['Why people do it', [
        'To access liquidity without disposing of an asset they want to keep. To avoid realising a position at an inconvenient time. To obtain a stablecoin balance for spending or for another protocol while retaining exposure.',
        'All three are legitimate. None of them changes the fact that the position must be monitored.'
      ]],
      ['What it costs', [
        'Interest accrues continuously and is added to the debt, so the position deteriorates even if prices do nothing. Over long periods this is the quiet cost that pushes an initially comfortable loan toward its threshold.',
        'Plus gas on every interaction, and the liquidation bonus if the position is ever closed out.'
      ]],
      ['The trap: borrowing to buy more of the collateral', [
        'Borrowing stablecoins against an asset and buying more of that asset is leverage. It increases returns if the price rises and accelerates liquidation if it falls, because your collateral and your exposure are now the same asset.',
        'Positions constructed this way liquidate on ordinary drawdowns, not extraordinary ones.'
      ]],
      ['Using it conservatively', [
        'Borrow well below the maximum, prefer stablecoin debt against uncorrelated collateral, and keep spare collateral available to top up quickly. Decide in advance at what health factor you will act, because deciding during a fast move is not realistic.',
        'FBT Swap shows live loan positions and health where the protocol exposes it, names the data source, and never holds your collateral — repayment and top-ups are transactions you sign.'
      ]]
    ],
    facts: [
      ['Benefit', 'Liquidity without disposing of the asset'],
      ['Ongoing cost', 'Interest accrues into the debt continuously'],
      ['Trap', 'Borrowing to buy more of the same collateral is leverage'],
      ['Discipline', 'Decide your action threshold before you need it']
    ],
    faqs: [
      { q: 'Is borrowing against crypto a way to avoid selling?', a: 'It defers a sale and replaces it with liquidation risk and interest. If the position is liquidated you have sold anyway, at a worse price and with a bonus paid to the liquidator.' },
      { q: 'What is a conservative loan-to-value?', a: 'Far below the protocol maximum, with the exact figure depending on how volatile your collateral is. The relevant test is whether an ordinary bad week would reach your threshold.' },
      { q: 'Can I repay early?', a: 'Yes. These loans have no fixed term and no prepayment penalty — interest accrues per block and stops when you repay. Partial repayment immediately improves your health factor.' }
    ]
  })
];
