/** CLUSTER: tokenized assets — 6 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'tokenized-stocks-explained',
    cluster: 'tokenized',
    icon: 'stocks',
    title: 'Tokenized Stocks: What You Actually Hold',
    description:
      'A token tracking a share price is not a share. Who holds the underlying, what rights transfer, and where the structure breaks.',
    h1: 'A token that tracks a share is a claim, not ownership',
    intro: [
      'Tokenized equity gives you an on-chain instrument whose price follows a listed share. It trades continuously, settles in minutes, and can be held in a self-custodied wallet.',
      'What it is not is the share itself. Between you and the equity there is an issuer, a custodian, and a legal structure — and the quality of those determines what you own.'
    ],
    sections: [
      ['The structures in use', [
        'Fully backed: an entity buys the real share, holds it with a custodian, and issues a token redeemable against it. Your exposure is to the issuer and custodian as well as the company.',
        'Synthetic: no underlying share exists. Price tracking comes from collateral and an oracle. Your exposure is to the protocol design and the oracle.',
        'Derivative-based: the issuer holds a contract rather than the share. Your exposure includes the counterparty on that contract.'
      ]],
      ['What rights do not transfer', [
        'Voting is almost never passed through. Dividends may be distributed, reinvested or simply absent depending on the structure. Corporate actions such as splits and mergers depend entirely on the issuer handling them correctly.',
        'Shareholder protections generally attach to the registered holder, which is the custodian, not you.'
      ]],
      ['Where the tracking breaks', [
        'Price links to the underlying through arbitrage, which requires someone able to create and redeem. If that path is restricted or liquidity is thin, the token can trade away from the reference price.',
        'Traditional markets close; the token does not. Over a weekend the token is trading on expectation with no reference, and gaps at the open can be severe.'
      ]],
      ['Before buying one', [
        'Establish which structure it is, who the custodian is, whether holdings are independently attested, who can redeem, and what happens to dividends. If those answers are not published clearly, that is the answer.',
        'FBT Swap displays market data for listed instruments with the source named. It does not issue, custody or redeem tokenized equity, and it takes no position on whether any instrument is worth holding.'
      ]]
    ],
    facts: [
      ['Not', 'Ownership of the underlying share'],
      ['Structures', 'Fully backed, synthetic, or derivative-based'],
      ['Rarely transferred', 'Voting rights and shareholder protections'],
      ['Tracking depends on', 'A working create-and-redeem arbitrage path']
    ],
    faqs: [
      { q: 'Do I own the company shares?', a: 'No. You hold a token issued against a structure. Even in the fully backed case the registered holder is a custodian, and your claim is against the issuer.' },
      { q: 'Do I receive dividends?', a: 'Sometimes, depending on the issuer. Dividends may be distributed, reflected in the token price, or not passed through at all. The documentation should state it explicitly.' },
      { q: 'Why does the price differ from the real stock?', a: 'Arbitrage keeps them aligned only if creation and redemption work. Restricted access, thin liquidity or closed underlying markets all allow the token to drift from the reference.' }
    ]
  }),

  article({
    slug: 'real-world-assets-on-chain',
    cluster: 'tokenized',
    icon: 'globe',
    title: 'Real-World Assets On-Chain: The Oracle and Custody Problem',
    description:
      'Treasuries, credit, property and commodities as tokens. Blockchain settles the token; everything about the asset still depends on institutions.',
    h1: 'The chain can settle the token, not the asset',
    intro: [
      'Tokenizing a real-world asset puts a transferable claim on-chain. Settlement becomes fast, fractional ownership becomes easy, and the claim can move without a transfer agent.',
      'None of that changes the fact that the asset itself exists off-chain, in someone\'s custody, verified by someone\'s report.'
    ],
    sections: [
      ['What tokenization genuinely solves', [
        'Settlement speed, fractional ownership, programmable transfer restrictions, continuous trading hours, and transparent on-chain records of who holds what.',
        'For instruments where settlement has historically taken days and minimum sizes were large, this is a substantive improvement rather than a repackaging.'
      ]],
      ['What it does not solve', [
        'Whether the asset exists, whether it is encumbered, whether the custodian is solvent, and whether the valuation is honest. The chain records a token; it cannot verify a building, a loan book or a bar of metal.',
        'This is the oracle problem in its most consequential form, and no amount of on-chain sophistication removes it.',
        "Attestation frequency is the practical measure of how much the record is worth. A monthly report means the on-chain supply can be wrong for up to a month before any external party checks it. Daily reporting by an independent firm is meaningfully stronger, and it is rare."
      ]],
      ['Legal enforceability', [
        'If the issuer fails, your recourse is a legal claim in whatever jurisdiction the structure sits, against an entity that may be a special-purpose vehicle with limited assets. Token holders have sometimes ranked behind other creditors.',
        'The quality of the legal wrapper matters more than the quality of the smart contract, and it is harder to evaluate.'
      ]],
      ['What to verify', [
        'Who holds the asset, whether an independent party attests to holdings and how often, which jurisdiction governs, what the redemption process is in practice, and whether transfers are restricted to approved addresses.',
        'FBT Swap presents market data for tokenized instruments with the source named. It does not custody, attest to or redeem real-world assets, and shows an unavailable state rather than estimating a value it cannot verify.'
      ]]
    ],
    facts: [
      ['Improves', 'Settlement speed, fractionalisation, transparent records'],
      ['Does not establish', 'That the asset exists, is unencumbered or is valued honestly'],
      ['Real recourse', 'A legal claim against the issuing entity, in its jurisdiction'],
      ['Verify', 'Custodian, independent attestation, jurisdiction, redemption in practice']
    ],
    faqs: [
      { q: 'Is a tokenized treasury as safe as a treasury?', a: 'It adds the issuer, the custodian and the smart contract to the risk you are taking. The underlying may be very safe while the wrapper is not, and the wrapper is what you hold.' },
      { q: 'What happens if the issuer fails?', a: 'You have a legal claim in the governing jurisdiction, which may be slow and may rank behind other creditors. The token itself cannot enforce anything off-chain.' },
      { q: 'Why are transfers sometimes restricted?', a: 'Regulated instruments often require holders to be approved, so the contract enforces a permitted-address list. That is a compliance feature and it means the token is not freely transferable.' }
    ]
  }),

  article({
    slug: 'stablecoin-types-compared',
    cluster: 'tokenized',
    icon: 'coins',
    title: 'Stablecoin Types: Fiat-Backed, Crypto-Backed, Algorithmic',
    description:
      'Three designs with three different ways of failing. What backs each, what attestation proves, and which risks are live at any time.',
    h1: 'Stable until the specific thing holding it stops working',
    intro: [
      'Every stablecoin maintains its peg by some mechanism, and each mechanism has a failure mode. They have all been tested, and the results differ sharply.',
      'The useful question is not "is this stable" but "what exactly holds it, and what would break that".'
    ],
    sections: [
      ['Fiat-backed', [
        'A company holds cash and short-term instruments and issues tokens against them. The peg holds because large holders can redeem at par, and arbitrage transmits that to the market.',
        'The risks are the issuer\'s solvency, the quality of reserves, who is actually allowed to redeem, and the issuer\'s ability to freeze balances. Attestations are point-in-time reviews, not continuous guarantees.',
        "Redemption access is the detail that decides whether the peg has a floor under it. If only vetted institutional accounts above a large minimum can redeem at par, the mechanism still functions, but it functions through them, and it stops functioning if they decline to act."
      ]],
      ['Crypto-backed', [
        'Overcollateralised with volatile assets, with positions liquidated when collateral falls below a threshold. No company holds reserves, and the mechanism is verifiable on-chain.',
        'The risks are a collateral crash faster than liquidations can clear, oracle failure during volatility, and governance decisions about collateral types. Many such systems now hold significant fiat-backed stablecoins as collateral, which reimports that risk.'
      ]],
      ['Algorithmic', [
        'Peg maintained by supply adjustment or an arbitrage loop with a companion token, without sufficient external collateral. The mechanism depends on continued demand for the companion asset.',
        'This design has failed repeatedly and at enormous scale. The failure mode is reflexive: the conditions that stress the peg also destroy the asset meant to defend it.'
      ]],
      ['Choosing between them', [
        'For holding value, the live questions are counterparty exposure, freeze capability, and how the mechanism behaves under stress rather than in calm markets. Diversifying across designs reduces correlated exposure.',
        'FBT Swap lists widely used stablecoins across its supported networks and shows the route and price impact for each. It does not issue stablecoins and takes no position on which to hold.'
      ]]
    ],
    facts: [
      ['Fiat-backed', 'Issuer solvency, reserve quality, redemption access, freeze capability'],
      ['Crypto-backed', 'Collateral crashes, oracle failure, governance decisions'],
      ['Algorithmic', 'Reflexive collapse — repeatedly demonstrated at scale'],
      ['Attestation', 'A point-in-time review, not a continuous guarantee']
    ],
    faqs: [
      { q: 'Which type is safest?', a: 'Each concentrates risk differently. Fiat-backed depends on a company, crypto-backed on a mechanism under stress, algorithmic on sustained demand. The first two have survived serious tests; the third repeatedly has not.' },
      { q: 'Does an attestation prove reserves exist?', a: 'It states that an examiner checked balances at a point in time under agreed procedures. It is meaningful and it is weaker than a full audit, and nothing about it is continuous.' },
      { q: 'Can my stablecoin balance be frozen?', a: 'With most major fiat-backed stablecoins, yes — the issuer can blacklist addresses. This has been used in response to law enforcement requests, and it is a property of the token you are holding.' }
    ]
  }),

  article({
    slug: 'commodity-tokens-explained',
    cluster: 'tokenized',
    icon: 'coins',
    title: 'Gold and Commodity Tokens: Redemption Is the Test',
    description:
      'A token claiming to represent metal is only worth the redemption path behind it. Storage, attestation, minimums and fees decide the real value.',
    h1: 'The claim is only as good as the ability to redeem it',
    intro: [
      'A gold token represents a quantity of metal held somewhere by someone. The appeal is obvious: exposure to a physical commodity with on-chain transferability and no vault of your own.',
      'Everything depends on whether the claim is honoured, and the terms of redemption usually tell you more than the marketing does.'
    ],
    sections: [
      ['Who holds the metal, and where', [
        'A named custodian in a named jurisdiction, ideally with allocated storage where specific bars are assigned to the issuer rather than pooled. Unallocated storage makes you a general creditor of the custodian.',
        'Bar lists with serial numbers and independent audits are the meaningful disclosures. A statement that reserves are "fully backed" without either is not a disclosure.'
      ]],
      ['The redemption terms', [
        'Minimum redemption size is the key figure. If redemption requires a full bar, a holder with a small position cannot redeem and the arbitrage that supports the peg depends entirely on large holders.',
        'Also check fees, geographic restrictions, required verification and typical processing time. Each one narrows who can actually enforce the claim.',
        "Jurisdiction decides whether any of it is enforceable. A custodian in a venue with strong property law and an issuer incorporated in one without is a common arrangement, and the weaker of the two is the one that matters on the day something goes wrong."
      ]],
      ['Costs that accrue', [
        'Storage and insurance are real ongoing expenses, charged either as a management fee, a small per-transfer fee, or gradual reduction of metal per token. An apparently free token is charging somewhere.',
        'Over long holding periods these compound and are the main reason a token underperforms the metal it tracks.'
      ]],
      ['Tracking in practice', [
        'The token tracks the commodity when creation and redemption work. If either is restricted, it trades on sentiment and can deviate — usually at exactly the moment holders most want the link to hold.',
        'FBT Swap shows market data for listed instruments with the source named. It does not custody metal, does not issue commodity tokens and does not process redemptions.'
      ]]
    ],
    facts: [
      ['Key disclosure', 'Named custodian, allocated storage, bar list, independent audit'],
      ['Key term', 'Minimum redemption size — it determines who can enforce the claim'],
      ['Hidden cost', 'Storage and insurance, charged as fees or metal reduction'],
      ['Peg holds while', 'Creation and redemption remain open and economical']
    ],
    faqs: [
      { q: 'Can I actually redeem for physical metal?', a: 'Sometimes, subject to minimums, fees, verification and location. For many holders the minimum exceeds their position, which means the claim is practically unenforceable by them.' },
      { q: 'What does "fully backed" mean here?', a: 'Only what the issuer defines it to mean. Allocated storage with serial-numbered bars and independent audits is meaningful; the phrase on its own is not.' },
      { q: 'Why does the token lag the metal price?', a: 'Ongoing storage and insurance costs, charged as fees or as a gradual reduction in metal per token. Over long periods this is the main source of divergence.' }
    ]
  }),

  article({
    slug: 'tokenized-treasury-bills',
    cluster: 'tokenized',
    icon: 'receipt',
    title: 'Tokenized Treasury Bills: Yield With a Wrapper Attached',
    description:
      'Government debt delivered as a token. The underlying may be very safe while the structure around it is not — and the structure is what you hold.',
    h1: 'Safe underlying, and a wrapper that is a separate question',
    intro: [
      'Tokenized treasury products hold short-dated government debt and pass the yield to token holders. They have grown quickly because the yield is real, the underlying is about as safe as financial instruments get, and settlement is on-chain.',
      'The underlying is not what you hold. You hold a token issued by a structure, and that structure has its own risks.'
    ],
    sections: [
      ['How yield reaches you', [
        'Either the token balance rebases upward, or the token price appreciates against a stable reference, or distributions are paid separately. Each has different tax and accounting consequences depending on where you are.',
        'The yield is the underlying rate minus management and custody fees, which can be a meaningful share when rates are low.'
      ]],
      ['The structural layers', [
        'A fund or special-purpose vehicle holds the bills. A custodian holds the securities. A transfer agent or smart contract tracks token holders. A jurisdiction governs the arrangement.',
        'Each layer is a dependency. The bills can be perfectly sound while the vehicle, the custodian or the legal wrapper is the problem.',
        "Concentration is worth checking as well. Several of these products route through the same small set of custodians, administrators and transfer agents, so holding two different tokens can turn out to be one operational exposure wearing two different names."
      ]],
      ['Access restrictions', [
        'Many of these products are restricted to qualified or non-US investors, enforced on-chain through a permitted-address list. Transfers to unapproved addresses simply fail.',
        'That is a compliance requirement rather than a defect, and it means the token is not freely transferable and secondary liquidity may be limited.'
      ]],
      ['Redemption and liquidity', [
        'Redemption typically settles on a schedule matching the underlying market, not instantly, and may have minimums. Secondary market liquidity varies and can be thin.',
        'FBT Swap displays market data for listed instruments with the source named. It does not issue or redeem tokenized treasuries, does not guarantee any rate, and shows an unavailable state rather than displaying a yield it cannot source.'
      ]]
    ],
    facts: [
      ['Underlying', 'Short-dated government debt — low credit risk'],
      ['You hold', 'A token issued by a vehicle, custodian and legal structure'],
      ['Net yield', 'Underlying rate minus management and custody fees'],
      ['Access', 'Often restricted to approved addresses by design']
    ],
    faqs: [
      { q: 'Is this as safe as holding treasuries directly?', a: 'The underlying credit risk is similar. You additionally take issuer, custodian, smart contract and legal-structure risk, none of which exists when you hold the security directly.' },
      { q: 'Can anyone buy these?', a: 'Often not. Many are restricted to qualified or non-US investors and enforce it on-chain, so transfers to unapproved addresses fail at the contract level.' },
      { q: 'How quickly can I redeem?', a: 'Usually on a settlement schedule tied to the underlying market rather than instantly, and sometimes with minimums. Secondary market liquidity is the alternative and it varies.' }
    ]
  }),

  article({
    slug: 'nft-vs-fungible-tokens',
    cluster: 'tokenized',
    icon: 'grid',
    title: 'NFTs and Fungible Tokens: Different Standards, Different Risks',
    description:
      'Fungibility changes pricing, liquidity and custody. What an NFT actually stores on-chain, and why valuation is a different problem.',
    h1: 'One is interchangeable, the other is not — and that changes everything',
    intro: [
      'A fungible token is a quantity: any unit is identical to any other, and ten of them are worth ten times one. A non-fungible token is an identified item, and no two are substitutable.',
      'That single property difference drives almost every practical distinction between them.'
    ],
    sections: [
      ['Pricing and liquidity', [
        'A fungible token has one price and continuous liquidity in a pool. An NFT has a last sale, a floor price and an asking price, which are three different numbers that frequently disagree.',
        'There is no pool you can sell into at a known price. Selling requires a buyer for that specific item, which can take a long time or never happen.'
      ]],
      ['What is actually stored on-chain', [
        'Usually a token ID, an owner, and a URI pointing to metadata. The image and attributes often live off-chain, on centralised storage or a content-addressed network that still requires someone to keep hosting it.',
        'If the metadata host disappears, the token persists and the content does not. Fully on-chain NFTs exist and are the exception.',
        "Royalties followed a similar path. They were widely described as enforced by the token, when in practice most were honoured voluntarily by marketplaces, and when venues stopped honouring them the revenue simply stopped. What a standard guarantees and what the market does are separate questions."
      ]],
      ['Standards and wallet behaviour', [
        'Fungible tokens follow a simple transfer and approval model. NFT standards add per-item approvals and an approve-for-all permission that grants control over your entire collection in one signature.',
        'Approve-for-all is the mechanism behind most NFT drains, and it is requested routinely by marketplaces. Review it the way you would review an unlimited token approval.'
      ]],
      ['Valuation is a different discipline', [
        'Fungible tokens can be valued against supply, flows and comparable assets. NFT value rests on provenance, rarity within a collection, and demand for that collection — closer to collectibles than to securities.',
        'FBT Swap handles fungible token swaps across its supported networks. It does not trade or value NFTs, and it takes no position on what any item is worth.'
      ]]
    ],
    facts: [
      ['Fungible', 'Interchangeable units, one price, pooled liquidity'],
      ['Non-fungible', 'Identified items, no substitution, buyer-by-buyer sales'],
      ['Usually off-chain', 'The image and metadata behind an NFT'],
      ['Key risk', 'Approve-for-all grants control over an entire collection']
    ],
    faqs: [
      { q: 'Does an NFT store the image?', a: 'Usually not. It stores a pointer to metadata that is typically hosted elsewhere. If that hosting lapses, the token remains and the content it referenced may not be retrievable.' },
      { q: 'Why is the floor price not what I can sell for?', a: 'The floor is the lowest asking price, not a bid. Selling immediately means accepting whatever the highest actual offer is, which is usually well below the floor.' },
      { q: 'What is approve-for-all?', a: 'A single approval granting a contract permission to transfer every item in a collection you own. It is standard for marketplaces and is the most common path for NFT theft, so it warrants deliberate review.' }
    ]
  })
];
