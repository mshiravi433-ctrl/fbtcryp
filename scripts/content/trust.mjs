/**
 * TRUST AND TRANSPARENCY — the E-E-A-T cluster.
 * ---------------------------------------------------------------------------
 * Search quality raters are told to find out who is responsible for a site,
 * especially one that touches money, and to penalise pages that hide it. For
 * a non-custodial crypto product the honest answer is unusually specific and
 * unusually reassuring, so it is stated plainly rather than buried in a
 * footer: one company, one domain, one contact address, one revenue line.
 *
 * The page that matters most here is "what FBT Swap cannot do". Every real
 * limitation is written down in one list — no recovery, no reversal, no
 * freezing, no auditing of imported tokens, no price forecasts. That is a
 * genuine trust signal precisely because nobody writes it unless it is true,
 * and it is the page a user needs BEFORE the mistake rather than after it.
 */

import { article } from './schema.mjs';

const C = 'trust';

/* ─── ENGLISH ──────────────────────────────────────────────────────────────── */

const en = [
  article({
    slug: 'about',
    cluster: C,
    icon: 'info',
    title: 'About FBT Swap — Operator, Product and Scope | FBT Swap',
    description:
      'Who builds and operates FBT Swap, what the product actually is, which networks it covers, and the boundary between the interface and the blockchains it reads.',
    h1: 'About FBT Swap',
    intro: [
      'FBT Swap is a non-custodial crypto swap interface and portfolio app for Android and the web, built and operated by Fanous Bazaar Pishgam Co., a company based in Isfahan, Iran. Persian and English are both first-class languages in the product rather than one being a translation of the other.',
      'The product does three things: it reads public blockchain and market data, it requests swap quotes from public decentralised-exchange aggregators on seventeen networks, and it assembles a transaction for your own wallet to sign. It does not do a fourth thing, and most misunderstandings about it come from assuming otherwise.'
    ],
    sections: [
      [
        'What the product is, precisely',
        [
          'An interface. Not an exchange, not a broker, not a custodian. There is no FBT order book, no FBT liquidity pool and no FBT balance. When you swap, your wallet signs a transaction that interacts with third-party smart contracts on a public blockchain, and the assets move from your address to wherever that contract sends them.',
          'This matters because it determines who is responsible for what. The route and the price come from aggregators. Settlement and finality come from the network. The interface is responsible for showing you accurate information before you sign — the network, the rate, the fee — and that is the part we can actually be held to.'
        ]
      ],
      [
        'What it covers',
        [
          'Swaps across sixteen EVM networks plus Solana, with the selected network displayed before every signature. A portfolio view that reads balances from public data. Market readings shown with their source and time window named. Price alerts that notify but never execute, because an app that filled orders unattended would need custody it does not have.',
          'Each supported network has its own page stating its chain ID, its gas token and its block explorer, generated from the same registry the app itself uses. That is deliberate: a page that claims a chain ID the app does not support is worse than no page at all, and generating them from one source makes that mistake impossible.'
        ]
      ],
      [
        'Who to contact, and how to tell it is us',
        [
          'The only official domain is fbtswap.ir. The only contact address is fbtswap@gmail.com. We do not run support accounts on messaging platforms, and we never start a conversation with a user — not by direct message, not by phone, not by email.',
          'That rule is worth memorising, because impersonation is the most common attack against users of any crypto product. Anyone who contacts you claiming to be FBT Swap support is not FBT Swap support, regardless of what their display name or profile picture says.'
        ]
      ],
      [
        'What this page is not',
        [
          'Nothing here is financial advice. The product does not forecast prices, does not recommend trades and does not present historical chart patterns as signals. Market data is shown with its source and window named so you can judge it, and where a source is unavailable the interface says so rather than printing a number it does not have.',
          'Crypto assets are volatile and self-custody carries real responsibility. Those two sentences are not boilerplate: the first means you can lose money, and the second means there is no helpdesk that can undo it for you.'
        ]
      ]
    ],
    facts: [
      ['Operator', 'Fanous Bazaar Pishgam Co., Isfahan, Iran'],
      ['Product type', 'Non-custodial swap interface and portfolio app'],
      ['Platforms', 'Android and web'],
      ['Networks', '16 EVM chains plus Solana'],
      ['Official domain', 'fbtswap.ir — there is no other']
    ],
    faqs: [
      {
        q: 'Is FBT Swap an exchange?',
        a: 'No. It is an interface to public decentralised exchanges. It holds no liquidity, runs no order book and takes no deposits. Your wallet interacts directly with third-party contracts on the network you selected.'
      },
      {
        q: 'Do I need an account?',
        a: 'Not for the on-chain swap interface. There is no FBT account, no email requirement and no identity check. Your wallet is the only identity involved. Wallets and third-party providers may impose their own requirements.'
      }
    ]
  }),

  article({
    slug: 'trust/how-we-make-money',
    cluster: C,
    icon: 'receipt',
    title: 'How FBT Swap Makes Money — The Whole Revenue Model | FBT Swap',
    description:
      'One revenue line, stated in full: a 0.70% platform fee on swap input, shown before you sign. No spread, no data sales, no paid routing placement.',
    h1: 'How FBT Swap makes money',
    intro: [
      'A free product with no visible revenue model is a product whose revenue model you have not found yet. Usually it is order flow, a widened spread, or your data. It is worth knowing which, because the answer tells you whose interest the software actually serves.',
      'FBT Swap has one revenue line and it is a 0.70% platform fee on the input amount of a swap, displayed on screen before you sign. That is the entire model. Everything below is detail about what is not in it.'
    ],
    sections: [
      [
        'The fee, exactly',
        [
          'The platform fee is 0.70% of the amount you are swapping from, not of the amount you receive, and not of your wallet balance. It is identical on every supported network — the same figure on Ethereum as on Solana — and it is shown before you confirm, alongside the rate and the selected network.',
          'It is one of three costs in a swap and the only one we receive. Network gas goes to the chain, paid in that chain native token, and we never deduct it. The pool fee is inside the price the aggregator quotes and goes to liquidity providers. Three recipients, and we are one of them.'
        ]
      ],
      [
        'What we do not do',
        [
          'We do not widen the quoted spread. The rate you see is what the aggregator returned, with our fee shown separately rather than hidden inside a worse price — which is the standard way a fee gets concealed and the reason "zero fee" claims are so often untrue.',
          'We do not sell user data, we do not run ads, and there is no subscription tier. We take no payment for routing: the route shown is the best among the venues queried at that moment, and no venue can buy its way to the top of that list.'
        ]
      ],
      [
        'Why disclose the number at all',
        [
          'Because a fee you can see is a fee you can compare, and a product confident in its pricing has no reason to hide it. If 0.70% is too much for your trade size, that is a legitimate conclusion and you should act on it — a large order on a deep pair may well be cheaper somewhere else, and we would rather you know that than find out later.',
          'Disclosure also puts a limit on us. A number printed on screen before every signature is a number we cannot quietly change, and that constraint is the point of showing it rather than publishing it in a policy page nobody opens.'
        ]
      ],
      [
        'What the fee does not buy',
        [
          'It does not buy insurance, a guarantee of execution, or any claim against us if a trade goes badly. It does not make us a counterparty to the swap. It does not give us the ability to reverse, freeze or recover anything, because none of those are possible for a service that never holds your assets.',
          'It also does not buy price improvement we cannot deliver. Routing through an aggregator reduces exposure to sandwich attacks; it does not make a public mempool transaction immune to them, and we will not claim otherwise to justify the charge.'
        ]
      ]
    ],
    facts: [
      ['Platform fee', '0.70% of the input amount'],
      ['Where it is shown', 'On screen, before you sign, on every network'],
      ['Network gas', 'Paid to the chain, never deducted by FBT Swap'],
      ['Pool fee', 'Inside the quoted price, paid to liquidity providers'],
      ['Other revenue', 'None — no ads, no data sales, no paid routing']
    ],
    faqs: [
      {
        q: 'Is the fee lower for large trades?',
        a: 'No. It is 0.70% of the input regardless of size. For a large order on a deep pair, that can make another venue cheaper overall, and checking is reasonable — the fee is disclosed before signing precisely so you can.'
      },
      {
        q: 'Does FBT Swap earn anything from the pool fee or gas?',
        a: 'No. The pool fee goes to liquidity providers and gas goes to the network validators or is burned, depending on the chain. Neither passes through us, and neither is something we can discount.'
      }
    ]
  }),

  article({
    slug: 'trust/what-we-cannot-do',
    cluster: C,
    icon: 'shield',
    title: 'What FBT Swap Cannot Do For You | FBT Swap',
    description:
      'The complete list of limitations: no reversals, no freezing, no recovery of a lost phrase or a wrong-network send, no contract audits, no price forecasts.',
    h1: 'What FBT Swap cannot do for you',
    intro: [
      'Every limitation on this page follows from one fact: FBT Swap never holds your assets or your keys. That is the main thing people want from a non-custodial product, and it is also the reason the list below exists. You cannot have an intermediary who is unable to touch your funds and also an intermediary who can rescue them.',
      'This page is here to be read before something goes wrong. A user who knows these boundaries takes different precautions — a test transfer, a revoked approval, a second look at the network selector — and those precautions are the only protection that actually works.'
    ],
    sections: [
      [
        'We cannot reverse, freeze or refund anything',
        [
          'Once your wallet signs and the network confirms, the transaction is final. There is no pending state we can cancel, no balance we can hold back and no chargeback mechanism on a blockchain. This applies equally to a swap you regret, a transfer to a wrong address and a withdrawal sent on the wrong network.',
          'A wrong-network send is the harshest case. Whether anything can be recovered depends entirely on whether you control the destination address on that other chain. If you do, the assets are there and you can access them with the right wallet configuration. If you do not, they are gone, and no amount of contacting us changes that.'
        ]
      ],
      [
        'We cannot recover a lost recovery phrase',
        [
          'We never see it, never store it and never ask for it. There is no reset link and no identity check that restores a wallet, because the phrase is the wallet — not a password protecting an account we hold on your behalf.',
          'This cuts both ways, and the good half matters too: nobody can be socially engineered into giving an attacker access to your wallet through us, because we have nothing to give. The cost of that protection is that the backup is entirely your responsibility.'
        ]
      ],
      [
        'We cannot vouch for tokens or contracts',
        [
          'We cannot audit arbitrary token contracts you import yourself. A token can carry a transfer fee, a blacklist, a mint function or an outright sell block, and a swap interface that quotes it successfully is not endorsing it. Verify a contract address against a source you trust before swapping into it.',
          'We also cannot guarantee that a quoted route is the best price available anywhere. It is the best among the venues queried at that moment. That is an honest claim and a useful one, but it is narrower than the one most interfaces imply.'
        ]
      ],
      [
        'We cannot predict, advise, or act for you',
        [
          'We do not forecast prices, recommend trades or present chart patterns as signals. Market readings are shown with their source and window named, and when a source is unavailable the interface says so instead of inventing a number. Price alerts notify you; they never fill an order unattended, because executing without you would require custody we do not have.',
          'We operate no lending or pool contracts and we do not liquidate positions. Where the app surfaces a third-party protocol, the risk, the terms and the outcome belong to that protocol, and reading its documentation is not optional.'
        ]
      ]
    ],
    facts: [
      ['Reversal or refund', 'Impossible — we never hold the funds'],
      ['Lost recovery phrase', 'Cannot be restored by anyone, including us'],
      ['Wrong-network sends', 'Recoverable only if you control the destination address'],
      ['Imported token contracts', 'Cannot be audited by us — verify them yourself'],
      ['Price forecasts and trade advice', 'Not provided, by policy']
    ],
    faqs: [
      {
        q: 'I sent tokens to the wrong network. Can support help?',
        a: 'There is nothing support can do, because the assets never passed through us. The only question that matters is whether you control the destination address on the other chain. If you do, add that network to your wallet and the balance should appear.'
      },
      {
        q: 'Can you block a scammer from receiving my funds?',
        a: 'No. We cannot freeze an address, cancel a confirmed transaction or recall assets. Any service claiming it can do this for a fee is itself the second scam, and it targets people who have already lost money once.'
      }
    ]
  }),

  article({
    slug: 'trust/security-practices',
    cluster: C,
    icon: 'lock',
    title: 'Security Practices — Keys, Data and What We Never Ask | FBT Swap',
    description:
      'How FBT Swap handles keys and data: nothing custodial, no recovery phrase requests, no unsolicited contact, and a published way to report a vulnerability.',
    h1: 'Security practices',
    intro: [
      'The strongest security property of this product is a negative one: there is no central store of user funds to attack. An interface that never takes custody cannot lose custody, and that removes the single largest category of catastrophic failure in crypto services.',
      'What remains is the set of things an interface can still get wrong — what it asks for, what it stores, what it shows before you sign, and how it behaves when something is reported. Those are the parts described below.'
    ],
    sections: [
      [
        'Keys and signatures',
        [
          'We never ask for a recovery phrase or a private key, under any circumstance, through any channel. There is no situation in which support needs one, and a request for one is definitive proof that you are not talking to us.',
          'Every transaction is signed in your own wallet, and the selected network is displayed before every signature. Approvals are a separate signature from the swap itself and deserve separate attention: an unlimited approval stays live until you revoke it, which is why the guides keep returning to revocation.'
        ]
      ],
      [
        'Data',
        [
          'The on-chain swap interface requires no account, no email and no identity document. Your wallet address is the identity involved, and it is already public on the chain. We do not sell user data and there is no advertising network embedded in the product.',
          'Blockchain activity is not private, and no interface can make it so. Addresses, amounts and counterparties are permanently public, and an RPC endpoint can observe requests. Saying this clearly is more useful than a privacy claim the technology cannot support.'
        ]
      ],
      [
        'Reporting a vulnerability',
        [
          'A security.txt file is published at the well-known path, as RFC 9116 specifies, with a contact address and a scope statement. Report a vulnerability to fbtswap@gmail.com before disclosing it publicly, and expect the scope to be this site and the Android app.',
          'Third-party aggregators, RPC providers, wallets and token contracts are outside that scope — not because they do not matter, but because we cannot fix them and a report sitting with us helps nobody. Those go to their own maintainers.'
        ]
      ],
      [
        'Impersonation, the actual threat',
        [
          'Most losses in this ecosystem do not come from broken cryptography. They come from someone being convinced to sign something or reveal something. The defences against that are social, not technical, so they are stated as rules rather than features.',
          'We never contact users first. The only official domain is fbtswap.ir and the only contact address is fbtswap@gmail.com. There is no airdrop that requires a recovery phrase, no support agent who needs your keys, and no "safe wallet" to move funds into. Any of those is an attack in progress.'
        ]
      ]
    ],
    facts: [
      ['Custody of funds', 'None — nothing to breach'],
      ['Recovery phrase requests', 'Never, through any channel'],
      ['Account required', 'None for the on-chain swap interface'],
      ['Vulnerability reports', 'fbtswap@gmail.com, scope published in security.txt'],
      ['Unsolicited contact from us', 'Never happens — treat it as an attack']
    ],
    faqs: [
      {
        q: 'Has FBT Swap been audited?',
        a: 'FBT Swap is an interface and holds no funds in its own contracts, so the relevant audits are those of the third-party protocols your wallet interacts with. Check each protocol own published audits; we cannot inherit or vouch for them.'
      },
      {
        q: 'What should I do if I think I signed something malicious?',
        a: 'Revoke the approval immediately from the wallet or a revocation tool, and move remaining assets to a fresh wallet if a private key may be exposed. Act first and investigate afterwards; an unrevoked approval can be drained at any later time.'
      }
    ]
  }),

  article({
    slug: 'trust/editorial-policy',
    cluster: C,
    icon: 'book',
    title: 'Editorial Policy — How These Guides Are Written | FBT Swap',
    description:
      'The rules every guide on this site follows: state the limitation, name the data source, no price forecasts, no affiliate placement, and corrections when wrong.',
    h1: 'Editorial policy',
    intro: [
      'There are over two hundred pages on this site, and most of them explain something that can cost a reader money if explained badly. That is a reason to publish the rules those pages are written under, so they can be checked against the pages themselves.',
      'The rules below are not aspirational. They are the constraints the content is actually written to, and the reason several obvious-looking topics are absent from the library entirely.'
    ],
    sections: [
      [
        'Every page states its limitation',
        [
          'A guide that describes only what works is a sales page wearing a guide costume. Each page here names the failure mode alongside the feature: alerts notify but never fill unattended, there are no gas refunds, routing reduces but does not eliminate MEV exposure, and a quote is the best among venues queried rather than the best that exists.',
          'This is why several pages read less flatteringly than a marketing team would prefer. It is also why they are useful at the only moment that counts, which is when something has already gone wrong.'
        ]
      ],
      [
        'Data gets a source and a window',
        [
          'Any market reading is shown with the source it came from and the time window it covers. A number without those two things is unverifiable, and an unverifiable number in a finance context is worse than no number at all.',
          'When a source is unavailable, the interface and the pages say so rather than falling back to a stale figure presented as current. An honest empty state beats an invented one, even though it looks worse.'
        ]
      ],
      [
        'What we will not publish',
        [
          'No price predictions, no "best coins to buy" lists and no chart patterns presented as signals. No tax guidance, because the product has no tax feature and a cluster covering a subject we do not serve is how a site earns a helpful-content demotion rather than authority.',
          'No affiliate placement inside editorial. A protocol does not appear in a guide because it paid to, and a routing venue cannot buy a mention. Where a third-party service is named, it is named because the explanation needs it.'
        ]
      ],
      [
        'Corrections',
        [
          'Chains change, fee models change and protocols are deprecated. When a page is wrong it gets fixed, and the facts most likely to drift — chain IDs, gas tokens, explorers, the supported network count — are generated from the application source rather than typed into prose, so they cannot silently fall out of date.',
          'If you find something incorrect, fbtswap@gmail.com reaches us. A specific URL and a specific claim is far more actionable than a general report, and we would rather fix a page than defend it.'
        ]
      ]
    ],
    facts: [
      ['Price forecasts', 'Never published'],
      ['Market data', 'Always with its source and time window named'],
      ['Affiliate placement in editorial', 'None'],
      ['Chain facts', 'Generated from the app source, not hand-typed'],
      ['Corrections', 'fbtswap@gmail.com, with the URL and the claim']
    ],
    faqs: [
      {
        q: 'Why is there no page about which coin will go up?',
        a: 'Because we would have to make it up. The product does not forecast prices and the editorial rules do not allow a page to imply knowledge nobody has. A guide on position sizing and risk is useful; a prediction is not.'
      },
      {
        q: 'Are these guides written to rank in search?',
        a: 'They are written to answer a real question completely, and organised into topic clusters so the answers link to each other. That structure helps in search because it is the structure a reference work has — the usefulness is the strategy, not a side effect of it.'
      }
    ]
  }),

  article({
    slug: 'trust/contact-and-verification',
    cluster: C,
    icon: 'alert',
    title: 'Contact and How to Verify It Is Really Us | FBT Swap',
    description:
      'One domain, one email address, and no unsolicited contact ever. How to check you are on the real site and recognise impersonation before it costs you.',
    h1: 'Contact, and how to verify it is really us',
    intro: [
      'Impersonation is the most effective attack against users of any crypto product, and it does not require breaking anything technical. It requires a convincing display name and a user in a hurry. The defence is a small number of facts held firmly enough that a plausible message cannot shake them.',
      'There is one official domain, one contact address, and one rule about who starts a conversation. Those three facts are below, and they do not have exceptions.'
    ],
    sections: [
      [
        'The three facts',
        [
          'The only official domain is fbtswap.ir. Not a variation with a hyphen, not a different extension, not a lookalike with a substituted character. Type it or use a bookmark you created yourself; search results and links in messages are both places where a fake outranks the real thing.',
          'The only contact address is fbtswap@gmail.com. And the rule that makes the other two usable: we never contact users first. Not by direct message, not by phone, not by email. A message that arrives unsolicited claiming to be us is not us, no matter how well it is written.'
        ]
      ],
      [
        'What we will never ask for',
        [
          'A recovery phrase or private key, under any circumstance. A remote-access or screen-sharing session. A transfer to a "safe" or "verification" address. A payment to unlock, release or recover funds. Each of these appears in real attacks, and each is conclusive: the request itself is the proof.',
          'There is also no legitimate airdrop, giveaway or migration that needs a seed phrase. The entire category is a lure, and it works because it arrives when someone is already excited about something else.'
        ]
      ],
      [
        'If you have already been contacted',
        [
          'Stop responding. Do not click anything in the message, including an unsubscribe link. If you connected a wallet to a site you now doubt, revoke its approvals immediately rather than waiting to see whether anything happens, because an approval can be used at any later time.',
          'If a recovery phrase was entered anywhere other than your own wallet, treat that wallet as compromised and move what remains to a newly generated one. Speed matters more than certainty here; a wallet you move out of unnecessarily costs you a little gas, and the alternative costs everything.'
        ]
      ],
      [
        'Reaching us legitimately',
        [
          'Email fbtswap@gmail.com. For a security issue, the scope and contact are also published in security.txt at the well-known path, as RFC 9116 specifies. Include the URL and a specific description — that is the difference between a report we can act on and one we cannot.',
          'What we cannot do by email is recover funds, reverse a transaction or restore a lost phrase. Those limits are described in full on the limitations page, and they apply no matter how the request reaches us.'
        ]
      ]
    ],
    facts: [
      ['Official domain', 'fbtswap.ir — the only one'],
      ['Contact address', 'fbtswap@gmail.com — the only one'],
      ['Unsolicited contact from us', 'Never happens'],
      ['Recovery phrase requests', 'Always an attack, no exceptions'],
      ['Security reports', 'security.txt at the well-known path, RFC 9116']
    ],
    faqs: [
      {
        q: 'Someone on a messaging app says they are FBT Swap support. Are they?',
        a: 'No. We do not operate support accounts on messaging platforms and we never start a conversation. The only contact route is email to fbtswap@gmail.com, initiated by you.'
      },
      {
        q: 'How do I check I am on the real site?',
        a: 'Read the full domain carefully — it is fbtswap.ir and nothing else — and reach it from your own bookmark rather than a link or an ad. Lookalike domains with substituted characters are specifically built to survive a quick glance.'
      }
    ]
  })
,

  article({
    slug: 'trust/press-kit',
    cluster: C,
    icon: 'grid',
    title: 'Press Kit — Brand, Boilerplate and Facts to Cite | FBT Swap',
    description:
      'Everything needed to write about FBT Swap accurately: correct naming, copy-ready boilerplate, the facts to cite, and the claims we ask you not to make.',
    h1: 'Press kit',
    intro: [
      'If you are writing about FBT Swap, reviewing it, listing it in a directory or citing it in an answer, this page has the material you need in a form you can copy. It exists because the alternative is being described from a marketing page, and marketing pages are where inaccuracies come from.',
      'The most important section is the last one. There are specific claims we ask people not to make on our behalf, because they are not true and because a product that lets flattering errors stand is telling you something about its other claims.'
    ],
    sections: [
      [
        'Naming and identity',
        [
          'The product is FBT Swap, two words, both capitalised. FBTSwap as one word is acceptable where a space is impossible, such as a username. In Persian it is اف‌بی‌تی سواپ. The operating company is Fanous Bazaar Pishgam Co., based in Isfahan, Iran, and it is the legal entity behind the product.',
          'The only official domain is fbtswap.ir, and a link should point there rather than to a mirror, a shortener or an app-store listing. The logo is served at the site root as icon-512.png, and the social card as social-card.png. The brand colour set is in the stylesheet; nothing needs permission to use for editorial purposes.'
        ]
      ],
      [
        'Boilerplate, copy-ready',
        [
          'Short: "FBT Swap is a non-custodial crypto swap interface and portfolio app for Android and the web, covering 16 EVM networks plus Solana in Persian and English."',
          'Long: "FBT Swap is a non-custodial crypto swap interface and portfolio app built by Fanous Bazaar Pishgam Co. of Isfahan, Iran. It aggregates public decentralised-exchange routes across sixteen EVM networks plus Solana, charges a 0.70% platform fee on the swap input that is displayed before signing, and never takes custody of user assets or recovery phrases. Persian and English are both first-class languages in the product."'
        ]
      ],
      [
        'Facts worth citing',
        [
          'Seventeen supported networks: sixteen EVM chains plus Solana. A 0.70% platform fee on the input amount, identical on every network and shown before the user signs. No account, email or identity document required for the on-chain swap interface. No custody of assets and no access to recovery phrases at any point.',
          'Three separate costs in a swap with three separate recipients: network gas to the chain, the pool fee to liquidity providers inside the quoted price, and the platform fee to FBT Swap. Each supported network has its own page carrying its chain ID, gas token and block explorer, generated from the application source so the figures cannot drift.'
        ]
      ],
      [
        'Claims we ask you not to make',
        [
          'Please do not describe FBT Swap as an exchange, a broker or a wallet. It is an interface to third-party decentralised exchanges; it runs no order book, holds no liquidity and stores no keys. Please do not say it offers the best price available — the accurate claim is the best route among the venues queried at that moment.',
          'Please do not describe it as MEV-proof, anonymous, insured, or able to recover lost funds. Routing reduces sandwich exposure without granting immunity. On-chain activity is public and no interface changes that. There is no insurance, and a non-custodial service cannot reverse, freeze or restore anything. We would rather be described accurately and less impressively.'
        ]
      ]
    ],
    facts: [
      ['Correct name', 'FBT Swap (اف‌بی‌تی سواپ)'],
      ['Legal entity', 'Fanous Bazaar Pishgam Co., Isfahan, Iran'],
      ['Link target', 'https://fbtswap.ir — the only official domain'],
      ['Logo and social card', '/icon-512.png and /social-card.png'],
      ['Press contact', 'fbtswap@gmail.com']
    ],
    faqs: [
      {
        q: 'Do I need permission to use the logo or write about FBT Swap?',
        a: 'No permission is needed for editorial, review or directory use. We ask only that the name is spelled correctly, the link points at fbtswap.ir, and the claims in the final section of this page are avoided.'
      },
      {
        q: 'Can you provide a quote or review access?',
        a: 'Email fbtswap@gmail.com. The product is open at fbtswap.ir with no account required, so you can evaluate the swap interface yourself before asking us anything — which is a better basis for a review than a prepared statement.'
      }
    ]
  })
];

/* ─── PERSIAN ──────────────────────────────────────────────────────────────── */

const fa = [
  article({
    slug: 'fa/about',
    cluster: C,
    lang: 'fa',
    icon: 'info',
    title: 'دربارهٔ اف‌بی‌تی سواپ — اپراتور، محصول و دامنهٔ کار | FBT Swap',
    description:
      'چه کسی اف‌بی‌تی سواپ را می‌سازد و اداره می‌کند، این محصول دقیقاً چیست، چه شبکه‌هایی را پوشش می‌دهد و مرز میان رابط کاربری و بلاک‌چین کجاست.',
    h1: 'دربارهٔ اف‌بی‌تی سواپ',
    intro: [
      'اف‌بی‌تی سواپ یک رابط سواپ غیرحضانتی و برنامهٔ سبد دارایی برای اندروید و وب است که شرکت فانوس بازار پیشگام مستقر در اصفهان ایران آن را ساخته و اداره می‌کند. فارسی و انگلیسی هر دو در این محصول زبان درجه‌یک‌اند، نه اینکه یکی ترجمهٔ دیگری باشد.',
      'این محصول سه کار می‌کند: دادهٔ عمومی بلاک‌چین و بازار را می‌خواند، از تجمیع‌کننده‌های عمومی صرافی غیرمتمرکز روی هفده شبکه نرخ سواپ می‌گیرد، و تراکنشی می‌سازد تا کیف پول خودت آن را امضا کند. کار چهارمی نمی‌کند و بیشتر سوءتفاهم‌ها دربارهٔ آن از همین فرض اشتباه می‌آید.'
    ],
    sections: [
      [
        'این محصول دقیقاً چیست',
        [
          'یک رابط کاربری است. نه صرافی، نه کارگزار، نه امانت‌دار. دفتر سفارش اف‌بی‌تی وجود ندارد، استخر نقدینگی اف‌بی‌تی وجود ندارد و موجودی اف‌بی‌تی وجود ندارد. وقتی سواپ می‌کنی، کیف پول تو تراکنشی را امضا می‌کند که با قراردادهای هوشمند شخص ثالث روی یک بلاک‌چین عمومی تعامل دارد و دارایی از آدرس تو به مقصدی می‌رود که همان قرارداد تعیین می‌کند.',
          'این نکته مهم است چون تعیین می‌کند مسئولیت هر بخش با کیست. مسیر و قیمت از تجمیع‌کننده‌ها می‌آید. تسویه و نهایی‌شدن کار شبکه است. مسئولیت رابط کاربری این است که پیش از امضا اطلاعات درست را نشانت بدهد — شبکه، نرخ، کارمزد — و همین بخش است که واقعاً می‌توان ما را بابتش بازخواست کرد.'
        ]
      ],
      [
        'چه چیزی را پوشش می‌دهد',
        [
          'سواپ روی شانزده شبکهٔ EVM به‌همراه سولانا، با نمایش شبکهٔ انتخاب‌شده پیش از هر امضا. نمای سبد دارایی که موجودی‌ها را از دادهٔ عمومی می‌خواند. نمایش بازار با ذکر منبع و بازهٔ زمانی. هشدار قیمت که اطلاع می‌دهد اما هرگز سفارش را پر نمی‌کند، چون برنامه‌ای که بدون حضور تو معامله کند به امانت‌داری‌ای نیاز دارد که ما نداریم.',
          'هر شبکهٔ پشتیبانی‌شده صفحهٔ خودش را دارد که شناسهٔ زنجیره، توکن کارمزد و کاوشگر بلاکش را می‌گوید و از همان مرجعی ساخته می‌شود که خود برنامه استفاده می‌کند. این عمدی است: صفحه‌ای که شناسهٔ زنجیره‌ای را ادعا کند که برنامه پشتیبانی نمی‌کند، از نبودِ صفحه بدتر است.'
        ]
      ],
      [
        'تماس با ما و تشخیص اینکه واقعاً ما هستیم',
        [
          'تنها دامنهٔ رسمی fbtswap.ir است. تنها نشانی تماس fbtswap@gmail.com است. ما حساب پشتیبانی روی پیام‌رسان‌ها نداریم و هرگز گفت‌وگو را با کاربر شروع نمی‌کنیم — نه با پیام مستقیم، نه تلفنی، نه با ایمیل.',
          'ارزش دارد این قاعده را به خاطر بسپاری، چون جعل هویت رایج‌ترین حمله علیه کاربران هر محصول کریپتویی است. هرکس با تو تماس بگیرد و بگوید پشتیبانی اف‌بی‌تی سواپ است، پشتیبانی اف‌بی‌تی سواپ نیست، نام نمایشی و عکس پروفایلش هرچه باشد.'
        ]
      ],
      [
        'این صفحه چه چیزی نیست',
        [
          'هیچ‌چیز اینجا توصیهٔ مالی نیست. این محصول قیمت پیش‌بینی نمی‌کند، معامله پیشنهاد نمی‌دهد و الگوهای نموداری گذشته را به‌عنوان سیگنال ارائه نمی‌کند. دادهٔ بازار با ذکر منبع و بازه نمایش داده می‌شود تا خودت قضاوت کنی، و هرجا منبعی در دسترس نباشد رابط همین را می‌گوید به‌جای اینکه عددی بسازد.',
          'دارایی‌های کریپتو پرنوسان‌اند و نگه‌داری شخصی مسئولیت واقعی دارد. این دو جمله تشریفاتی نیستند: اولی یعنی می‌توانی پول از دست بدهی و دومی یعنی هیچ میز پشتیبانی‌ای نیست که آن را برایت برگرداند.'
        ]
      ]
    ],
    facts: [
      ['اپراتور', 'شرکت فانوس بازار پیشگام، اصفهان، ایران'],
      ['نوع محصول', 'رابط سواپ غیرحضانتی و برنامهٔ سبد دارایی'],
      ['بسترها', 'اندروید و وب'],
      ['شبکه‌ها', '۱۶ شبکهٔ EVM به‌همراه سولانا'],
      ['دامنهٔ رسمی', 'fbtswap.ir — دامنهٔ دیگری وجود ندارد']
    ],
    faqs: [
      {
        q: 'اف‌بی‌تی سواپ یک صرافی است؟',
        a: 'نه. رابطی برای صرافی‌های غیرمتمرکز عمومی است. نقدینگی ندارد، دفتر سفارش ندارد و سپرده نمی‌پذیرد. کیف پول تو مستقیم با قراردادهای شخص ثالث روی شبکه‌ای که انتخاب کرده‌ای تعامل می‌کند.'
      },
      {
        q: 'به حساب کاربری نیاز دارم؟',
        a: 'برای رابط سواپ آن‌چین نه. حساب اف‌بی‌تی وجود ندارد، ایمیل لازم نیست و احراز هویت انجام نمی‌شود. کیف پول تو تنها هویت درگیر است. کیف پول‌ها و سرویس‌های شخص ثالث ممکن است الزامات خودشان را داشته باشند.'
      }
    ]
  }),

  article({
    slug: 'fa/trust/how-we-make-money',
    cluster: C,
    lang: 'fa',
    icon: 'receipt',
    title: 'اف‌بی‌تی سواپ چطور درآمد دارد — کل مدل درآمدی | FBT Swap',
    description:
      'یک خط درآمد، کامل: کارمزد ۰٫۷۰ درصدی پلتفرم روی ورودی سواپ که پیش از امضا نمایش داده می‌شود. بدون اختلاف قیمت پنهان و بدون فروش داده.',
    h1: 'اف‌بی‌تی سواپ چطور درآمد دارد',
    intro: [
      'محصول رایگانی که مدل درآمدی‌اش دیده نمی‌شود، محصولی است که هنوز مدل درآمدی‌اش را پیدا نکرده‌ای. معمولاً جریان سفارش است، اختلاف قیمت پهن‌شده، یا دادهٔ خودت. ارزش دارد بدانی کدام، چون پاسخ می‌گوید نرم‌افزار واقعاً منفعت چه کسی را دنبال می‌کند.',
      'اف‌بی‌تی سواپ یک خط درآمد دارد و آن کارمزد ۰٫۷۰ درصدی پلتفرم روی مقدار ورودی سواپ است که پیش از امضا روی صفحه نمایش داده می‌شود. کل مدل همین است. باقی این صفحه جزئیات چیزهایی است که در این مدل نیستند.'
    ],
    sections: [
      [
        'کارمزد، دقیق',
        [
          'کارمزد پلتفرم ۰٫۷۰ درصد از مقداری است که از آن سواپ می‌کنی، نه از مقداری که دریافت می‌کنی و نه از موجودی کیف پولت. روی همهٔ شبکه‌های پشتیبانی‌شده یکسان است — همان عدد روی اتریوم و روی سولانا — و پیش از تأیید، کنار نرخ و شبکهٔ انتخاب‌شده نمایش داده می‌شود.',
          'این یکی از سه هزینهٔ یک سواپ است و تنها هزینه‌ای که به ما می‌رسد. کارمزد شبکه با توکن بومی همان زنجیره به شبکه می‌رسد و ما هرگز آن را کسر نمی‌کنیم. کارمزد استخر داخل قیمتی است که تجمیع‌کننده اعلام می‌کند و به تأمین‌کنندگان نقدینگی می‌رسد. سه دریافت‌کننده، و ما یکی از آن‌هاییم.'
        ]
      ],
      [
        'چه کارهایی نمی‌کنیم',
        [
          'اختلاف قیمت اعلام‌شده را پهن نمی‌کنیم. نرخی که می‌بینی همان است که تجمیع‌کننده برگردانده و کارمزد ما جدا نشان داده می‌شود، نه پنهان‌شده در قیمتی بدتر — که روش استاندارد مخفی‌کردن کارمزد است و دلیل اینکه ادعاهای «بدون کارمزد» این‌قدر اغلب نادرست‌اند.',
          'دادهٔ کاربر نمی‌فروشیم، تبلیغ نمایش نمی‌دهیم و اشتراک پولی نداریم. بابت مسیریابی هیچ پولی نمی‌گیریم: مسیری که نشان داده می‌شود بهترین مسیر میان محل‌های پرسیده‌شده در همان لحظه است و هیچ محلی نمی‌تواند جایگاهش را در آن فهرست بخرد.'
        ]
      ],
      [
        'چرا اصلاً عدد را اعلام کنیم',
        [
          'چون کارمزدی که دیده می‌شود کارمزدی است که می‌توان مقایسه‌اش کرد، و محصولی که به قیمت‌گذاری‌اش مطمئن است دلیلی برای پنهان‌کردنش ندارد. اگر ۰٫۷۰ درصد برای اندازهٔ معاملهٔ تو زیاد است، این نتیجه‌گیری درستی است و باید بر اساسش عمل کنی — سفارش بزرگ روی یک جفت عمیق ممکن است جای دیگری ارزان‌تر تمام شود و ترجیح می‌دهیم همین حالا بدانی تا بعداً بفهمی.',
          'اعلام‌کردن برای خود ما هم محدودیت می‌سازد. عددی که پیش از هر امضا روی صفحه چاپ می‌شود، عددی است که نمی‌توانیم بی‌سروصدا تغییرش دهیم، و همین محدودیت دلیل نشان‌دادن آن است به‌جای انتشار در صفحهٔ قوانینی که کسی بازش نمی‌کند.'
        ]
      ],
      [
        'این کارمزد چه چیزی نمی‌خرد',
        [
          'بیمه نمی‌خرد، تضمین اجرا نمی‌خرد و هیچ ادعایی علیه ما در صورت بد پیش‌رفتن معامله ایجاد نمی‌کند. ما را طرف معاملهٔ سواپ نمی‌کند. توان برگرداندن، مسدودکردن یا بازیابی چیزی را به ما نمی‌دهد، چون هیچ‌کدام برای سرویسی که هرگز دارایی تو را نگه نمی‌دارد ممکن نیست.',
          'بهبود قیمتی را هم که نمی‌توانیم بدهیم نمی‌خرد. مسیریابی از طریق تجمیع‌کننده قرارگیری در معرض حملات ساندویچی را کم می‌کند؛ تراکنش عمومی را در برابر آن‌ها مصون نمی‌کند و ما برای توجیه این کارمزد خلافش را ادعا نمی‌کنیم.'
        ]
      ]
    ],
    facts: [
      ['کارمزد پلتفرم', '۰٫۷۰ درصد از مقدار ورودی'],
      ['کجا نمایش داده می‌شود', 'روی صفحه، پیش از امضا، روی هر شبکه'],
      ['کارمزد شبکه', 'به خود شبکه می‌رسد، هرگز توسط ما کسر نمی‌شود'],
      ['کارمزد استخر', 'داخل قیمت اعلام‌شده، متعلق به تأمین‌کنندگان نقدینگی'],
      ['درآمد دیگر', 'هیچ — بدون تبلیغ، بدون فروش داده، بدون مسیریابی پولی']
    ],
    faqs: [
      {
        q: 'برای معامله‌های بزرگ کارمزد کمتر می‌شود؟',
        a: 'نه. صرف‌نظر از اندازه ۰٫۷۰ درصد از ورودی است. برای سفارش بزرگ روی یک جفت عمیق، همین می‌تواند محل دیگری را در مجموع ارزان‌تر کند و بررسی‌کردنش منطقی است؛ کارمزد دقیقاً برای همین پیش از امضا اعلام می‌شود.'
      },
      {
        q: 'اف‌بی‌تی سواپ از کارمزد استخر یا کارمزد شبکه چیزی برمی‌دارد؟',
        a: 'نه. کارمزد استخر به تأمین‌کنندگان نقدینگی می‌رسد و کارمزد شبکه بسته به زنجیره به اعتبارسنج‌ها می‌رسد یا سوزانده می‌شود. هیچ‌کدام از ما عبور نمی‌کند و هیچ‌کدام چیزی نیست که بتوانیم تخفیف بدهیم.'
      }
    ]
  }),

  article({
    slug: 'fa/trust/what-we-cannot-do',
    cluster: C,
    lang: 'fa',
    icon: 'shield',
    title: 'چه کارهایی از اف‌بی‌تی سواپ برنمی‌آید | FBT Swap',
    description:
      'فهرست کامل محدودیت‌ها: بدون بازگشت تراکنش، بدون مسدودسازی، بدون بازیابی عبارت گمشده یا ارسال روی شبکهٔ اشتباه، بدون ممیزی قرارداد و بدون پیش‌بینی قیمت.',
    h1: 'چه کارهایی از اف‌بی‌تی سواپ برنمی‌آید',
    intro: [
      'هر محدودیت این صفحه از یک واقعیت می‌آید: اف‌بی‌تی سواپ هرگز دارایی یا کلیدهای تو را نگه نمی‌دارد. همین چیزی است که مردم از یک محصول غیرحضانتی می‌خواهند و دقیقاً دلیل وجود فهرست زیر هم هست. نمی‌شود واسطه‌ای داشت که نتواند به پول تو دست بزند و هم‌زمان بتواند نجاتش بدهد.',
      'این صفحه برای خوانده‌شدن پیش از رخ‌دادن مشکل نوشته شده. کاربری که این مرزها را بداند احتیاط‌های دیگری می‌کند — یک انتقال آزمایشی، باطل‌کردن یک مجوز، نگاه دوباره به انتخابگر شبکه — و همین احتیاط‌ها تنها محافظتی‌اند که واقعاً کار می‌کنند.'
    ],
    sections: [
      [
        'نمی‌توانیم چیزی را برگردانیم، مسدود کنیم یا جبران کنیم',
        [
          'وقتی کیف پول تو امضا کرد و شبکه تأیید کرد، تراکنش نهایی است. حالت در انتظاری نیست که لغوش کنیم، موجودی‌ای نیست که نگهش داریم و سازوکار بازگشت وجه روی بلاک‌چین وجود ندارد. این برای سواپی که پشیمانش شده‌ای، انتقالی به آدرس اشتباه و برداشتی روی شبکهٔ اشتباه یکسان صادق است.',
          'ارسال روی شبکهٔ اشتباه سخت‌ترین حالت است. اینکه چیزی قابل بازیابی باشد یا نه، فقط به این بستگی دارد که آدرس مقصد روی آن زنجیرهٔ دیگر در کنترل تو باشد. اگر هست، دارایی همان‌جاست و با پیکربندی درست کیف پول به آن می‌رسی. اگر نیست، رفته است و هیچ مقدار تماس با ما این را تغییر نمی‌دهد.'
        ]
      ],
      [
        'نمی‌توانیم عبارت بازیابی گمشده را برگردانیم',
        [
          'ما هرگز آن را نمی‌بینیم، ذخیره نمی‌کنیم و نمی‌خواهیم. لینک بازنشانی وجود ندارد و هیچ احراز هویتی کیف پول را برنمی‌گرداند، چون آن عبارت خودِ کیف پول است — نه رمزی که از حسابی محافظت می‌کند که ما به نیابت از تو نگه داشته باشیم.',
          'این موضوع دو سر دارد و سر خوبش هم مهم است: هیچ‌کس نمی‌تواند با فریب دادن ما دسترسی به کیف پول تو را به مهاجم بدهد، چون ما چیزی برای دادن نداریم. هزینهٔ این محافظت آن است که پشتیبان‌گیری کاملاً بر عهدهٔ خودت است.'
        ]
      ],
      [
        'نمی‌توانیم توکن‌ها و قراردادها را تضمین کنیم',
        [
          'نمی‌توانیم قرارداد توکن‌های دلخواهی را که خودت وارد می‌کنی ممیزی کنیم. یک توکن می‌تواند کارمزد انتقال داشته باشد، فهرست سیاه داشته باشد، تابع ضرب داشته باشد یا به‌کلی فروش را مسدود کند، و رابطی که با موفقیت برایش نرخ می‌گیرد آن را تأیید نکرده است. پیش از سواپ، آدرس قرارداد را با منبعی که به آن اعتماد داری تطبیق بده.',
          'همچنین نمی‌توانیم تضمین کنیم مسیر اعلام‌شده بهترین قیمت موجود در کل بازار است. بهترین میان محل‌هایی است که در آن لحظه پرسیده شده‌اند. این ادعای صادقانه و مفیدی است، اما باریک‌تر از چیزی است که بیشتر رابط‌ها القا می‌کنند.'
        ]
      ],
      [
        'نمی‌توانیم پیش‌بینی کنیم، توصیه کنیم یا به‌جای تو عمل کنیم',
        [
          'قیمت پیش‌بینی نمی‌کنیم، معامله پیشنهاد نمی‌دهیم و الگوهای نموداری را سیگنال معرفی نمی‌کنیم. خوانش‌های بازار با ذکر منبع و بازه نمایش داده می‌شوند و وقتی منبعی در دسترس نباشد رابط همین را می‌گوید به‌جای ساختن عدد. هشدار قیمت به تو اطلاع می‌دهد؛ هرگز بدون حضور تو سفارشی را پر نمی‌کند، چون اجرا بدون تو نیازمند امانت‌داری‌ای است که نداریم.',
          'ما هیچ قرارداد وام‌دهی یا استخری را اداره نمی‌کنیم و موقعیتی را لیکوئید نمی‌کنیم. هرجا برنامه یک پروتکل شخص ثالث را نمایش می‌دهد، ریسک و شرایط و نتیجه متعلق به همان پروتکل است و خواندن مستنداتش اختیاری نیست.'
        ]
      ]
    ],
    facts: [
      ['بازگشت یا جبران', 'ناممکن — ما هرگز پول را نگه نمی‌داریم'],
      ['عبارت بازیابی گمشده', 'هیچ‌کس نمی‌تواند برگرداند، از جمله ما'],
      ['ارسال روی شبکهٔ اشتباه', 'فقط اگر آدرس مقصد در کنترل خودت باشد'],
      ['قرارداد توکن واردشده', 'توسط ما ممیزی نمی‌شود — خودت بررسی کن'],
      ['پیش‌بینی قیمت و توصیهٔ معامله', 'طبق سیاست، ارائه نمی‌شود']
    ],
    faqs: [
      {
        q: 'توکن را روی شبکهٔ اشتباه فرستادم. پشتیبانی می‌تواند کمک کند؟',
        a: 'کاری از پشتیبانی برنمی‌آید، چون دارایی هرگز از ما عبور نکرده است. تنها پرسش مهم این است که آیا آدرس مقصد روی آن زنجیرهٔ دیگر در کنترل توست. اگر هست، آن شبکه را به کیف پولت اضافه کن تا موجودی ظاهر شود.'
      },
      {
        q: 'می‌توانید جلوی رسیدن پول من به کلاهبردار را بگیرید؟',
        a: 'نه. نمی‌توانیم آدرسی را مسدود کنیم، تراکنش تأییدشده را لغو کنیم یا دارایی را فرا بخوانیم. هر سرویسی که ادعا کند در ازای پول این کار را می‌کند، خودش کلاهبرداری دوم است و هدفش کسانی است که یک‌بار پول از دست داده‌اند.'
      }
    ]
  }),

  article({
    slug: 'fa/trust/security-practices',
    cluster: C,
    lang: 'fa',
    icon: 'lock',
    title: 'شیوه‌های امنیتی — کلید، داده و چیزی که هرگز نمی‌پرسیم | FBT Swap',
    description:
      'اف‌بی‌تی سواپ با کلید و داده چه می‌کند: بدون امانت‌داری، بدون درخواست عبارت بازیابی، بدون تماس ابتدایی، و مسیر منتشرشده برای گزارش آسیب‌پذیری.',
    h1: 'شیوه‌های امنیتی',
    intro: [
      'قوی‌ترین ویژگی امنیتی این محصول یک ویژگی منفی است: هیچ انبار مرکزی‌ای از پول کاربران وجود ندارد که بشود به آن حمله کرد. رابطی که هرگز امانت نمی‌گیرد نمی‌تواند امانت را از دست بدهد و همین بزرگ‌ترین دستهٔ شکست‌های فاجعه‌بار در سرویس‌های کریپتو را حذف می‌کند.',
      'آنچه می‌ماند مجموعهٔ چیزهایی است که یک رابط هنوز می‌تواند اشتباه انجام دهد — اینکه چه می‌پرسد، چه ذخیره می‌کند، پیش از امضا چه نشان می‌دهد و وقتی چیزی گزارش شد چطور رفتار می‌کند. همین بخش‌ها در ادامه توضیح داده شده‌اند.'
    ],
    sections: [
      [
        'کلید و امضا',
        [
          'ما هرگز عبارت بازیابی یا کلید خصوصی نمی‌خواهیم، تحت هیچ شرایطی و از هیچ مسیری. هیچ موقعیتی وجود ندارد که پشتیبانی به آن نیاز داشته باشد و درخواست آن اثبات قطعی این است که طرف صحبتت ما نیستیم.',
          'هر تراکنش در کیف پول خودت امضا می‌شود و پیش از هر امضا شبکهٔ انتخاب‌شده نمایش داده می‌شود. مجوز توکن امضایی جدا از خود سواپ است و توجه جداگانه می‌خواهد: مجوز نامحدود تا وقتی باطلش نکنی فعال می‌ماند و به همین دلیل راهنماها مدام به باطل‌کردن برمی‌گردند.'
        ]
      ],
      [
        'داده',
        [
          'رابط سواپ آن‌چین به حساب کاربری، ایمیل و مدرک هویتی نیاز ندارد. آدرس کیف پولت تنها هویت درگیر است و آن هم از قبل روی زنجیره عمومی است. ما دادهٔ کاربر نمی‌فروشیم و شبکهٔ تبلیغاتی‌ای در محصول تعبیه نشده است.',
          'فعالیت روی بلاک‌چین خصوصی نیست و هیچ رابطی نمی‌تواند خصوصی‌اش کند. آدرس‌ها، مبالغ و طرف‌های معامله برای همیشه عمومی‌اند و یک نقطهٔ RPC می‌تواند درخواست‌ها را ببیند. گفتن صریح این موضوع مفیدتر از ادعای حریم خصوصی‌ای است که فناوری پشتیبانی‌اش نمی‌کند.'
        ]
      ],
      [
        'گزارش آسیب‌پذیری',
        [
          'فایل security.txt طبق RFC 9116 روی مسیر استاندارد منتشر شده است، با نشانی تماس و بیان دامنهٔ کار. آسیب‌پذیری را پیش از افشای عمومی به fbtswap@gmail.com گزارش کن و انتظار داشته باش دامنه همین سایت و برنامهٔ اندروید باشد.',
          'تجمیع‌کننده‌های شخص ثالث، ارائه‌دهندگان RPC، کیف پول‌ها و قراردادهای توکن بیرون از این دامنه‌اند — نه چون اهمیت ندارند، بلکه چون ما نمی‌توانیم آن‌ها را درست کنیم و گزارشی که نزد ما بماند به کسی کمک نمی‌کند. آن‌ها باید به نگه‌دارندگان خودشان برسند.'
        ]
      ],
      [
        'جعل هویت، تهدید واقعی',
        [
          'بیشتر ضررهای این زیست‌بوم از شکستن رمزنگاری نمی‌آید. از این می‌آید که کسی قانع شده چیزی را امضا کند یا چیزی را فاش کند. دفاع در برابر آن اجتماعی است نه فنی، پس به‌شکل قاعده بیان می‌شود نه امکانات.',
          'ما هرگز اول با کاربر تماس نمی‌گیریم. تنها دامنهٔ رسمی fbtswap.ir و تنها نشانی تماس fbtswap@gmail.com است. هیچ ایردراپی وجود ندارد که عبارت بازیابی بخواهد، هیچ پشتیبانی‌ای به کلید تو نیاز ندارد و هیچ «کیف پول امنی» برای انتقال پول وجود ندارد. هر کدام از این‌ها یعنی حمله در جریان است.'
        ]
      ]
    ],
    facts: [
      ['امانت‌داری دارایی', 'هیچ — چیزی برای نفوذ وجود ندارد'],
      ['درخواست عبارت بازیابی', 'هرگز، از هیچ مسیری'],
      ['نیاز به حساب کاربری', 'برای رابط سواپ آن‌چین وجود ندارد'],
      ['گزارش آسیب‌پذیری', 'fbtswap@gmail.com، دامنه در security.txt'],
      ['تماس ابتدایی از سوی ما', 'هرگز رخ نمی‌دهد — آن را حمله بدان']
    ],
    faqs: [
      {
        q: 'اف‌بی‌تی سواپ ممیزی امنیتی شده است؟',
        a: 'اف‌بی‌تی سواپ یک رابط است و در قراردادهای خودش پولی نگه نمی‌دارد، پس ممیزی‌های مرتبط، ممیزی همان پروتکل‌های شخص ثالثی است که کیف پول تو با آن‌ها تعامل می‌کند. ممیزی منتشرشدهٔ هر پروتکل را خودت بررسی کن؛ ما نمی‌توانیم آن را به ارث ببریم یا تضمینش کنیم.'
      },
      {
        q: 'اگر فکر می‌کنم چیز مخربی را امضا کرده‌ام چه کنم؟',
        a: 'فوراً مجوز را از کیف پول یا یک ابزار باطل‌کردن لغو کن و اگر احتمال افشای کلید خصوصی هست دارایی باقی‌مانده را به کیف پول تازه منتقل کن. اول عمل کن و بعد بررسی؛ مجوزی که باطل نشده هر زمان دیگری هم می‌تواند خالی شود.'
      }
    ]
  }),

  article({
    slug: 'fa/trust/editorial-policy',
    cluster: C,
    lang: 'fa',
    icon: 'book',
    title: 'سیاست تحریریه — این راهنماها چطور نوشته می‌شوند | FBT Swap',
    description:
      'قواعدی که هر راهنمای این سایت از آن پیروی می‌کند: بیان محدودیت، ذکر منبع داده، بدون پیش‌بینی قیمت، بدون جایگاه تبلیغاتی و اصلاح هنگام اشتباه.',
    h1: 'سیاست تحریریه',
    intro: [
      'بیش از دویست صفحه روی این سایت هست و بیشترشان چیزی را توضیح می‌دهند که اگر بد توضیح داده شود می‌تواند برای خواننده هزینه بسازد. همین دلیل کافی است که قواعد نوشتن آن صفحه‌ها منتشر شود تا بشود خود صفحه‌ها را با آن سنجید.',
      'قواعد زیر آرزو نیستند. محدودیت‌هایی‌اند که محتوا واقعاً با آن‌ها نوشته می‌شود و دلیل اینکه چند موضوع به‌ظاهر بدیهی اصلاً در این کتابخانه نیستند.'
    ],
    sections: [
      [
        'هر صفحه محدودیتش را می‌گوید',
        [
          'راهنمایی که فقط بگوید چه چیزی کار می‌کند، صفحهٔ فروشی است که لباس راهنما پوشیده. هر صفحه اینجا حالت شکست را کنار امکانات می‌آورد: هشدار اطلاع می‌دهد اما بدون حضور تو سفارش پر نمی‌کند، کارمزد شبکه بازگردانده نمی‌شود، مسیریابی قرارگیری در معرض MEV را کم می‌کند نه حذف، و نرخ بهترین میان محل‌های پرسیده‌شده است نه بهترین موجود.',
          'به همین دلیل چند صفحه کمتر از آنچه یک تیم بازاریابی بپسندد خوشایندند. و به همین دلیل دقیقاً در لحظه‌ای مفیدند که اهمیت دارد، یعنی وقتی چیزی از قبل خراب شده است.'
        ]
      ],
      [
        'داده با منبع و بازه می‌آید',
        [
          'هر خوانش بازار با منبعی که از آن آمده و بازهٔ زمانی‌ای که پوشش می‌دهد نمایش داده می‌شود. عددی بدون این دو قابل راستی‌آزمایی نیست و عدد غیرقابل‌راستی‌آزمایی در زمینهٔ مالی از نبود عدد بدتر است.',
          'وقتی منبعی در دسترس نباشد، رابط و صفحه‌ها همین را می‌گویند به‌جای اینکه به عددی کهنه برگردند و آن را به‌عنوان به‌روز نشان دهند. حالت خالی صادقانه از حالت ساختگی بهتر است، حتی اگر بدتر به‌نظر برسد.'
        ]
      ],
      [
        'چه چیزی منتشر نمی‌کنیم',
        [
          'بدون پیش‌بینی قیمت، بدون فهرست «بهترین ارزها برای خرید» و بدون ارائهٔ الگوی نموداری به‌عنوان سیگنال. بدون راهنمای مالیاتی، چون این محصول امکانات مالیاتی ندارد و پوشش‌دادن موضوعی که به آن خدمت نمی‌کنیم راه رسیدن به جریمهٔ محتوای غیرمفید است، نه به اعتبار موضوعی.',
          'بدون جایگاه تبلیغاتی درون محتوا. هیچ پروتکلی به‌خاطر پرداخت پول در یک راهنما ظاهر نمی‌شود و هیچ محل معامله‌ای نمی‌تواند ذکر نامش را بخرد. هرجا سرویس شخص ثالثی نام برده می‌شود، چون توضیح به آن نیاز دارد نام برده شده است.'
        ]
      ],
      [
        'اصلاح‌ها',
        [
          'زنجیره‌ها تغییر می‌کنند، مدل‌های کارمزد تغییر می‌کنند و پروتکل‌ها از رده خارج می‌شوند. وقتی صفحه‌ای اشتباه باشد اصلاح می‌شود، و واقعیت‌هایی که بیشترین احتمال کهنه‌شدن دارند — شناسهٔ زنجیره، توکن کارمزد، کاوشگر و تعداد شبکه‌های پشتیبانی‌شده — به‌جای تایپ‌شدن در متن، از کد خود برنامه ساخته می‌شوند تا نتوانند بی‌صدا از اعتبار بیفتند.',
          'اگر چیزی نادرست دیدی، fbtswap@gmail.com به ما می‌رسد. یک نشانی مشخص و یک ادعای مشخص بسیار عملی‌تر از گزارش کلی است و ما ترجیح می‌دهیم صفحه را اصلاح کنیم تا از آن دفاع کنیم.'
        ]
      ]
    ],
    facts: [
      ['پیش‌بینی قیمت', 'هرگز منتشر نمی‌شود'],
      ['دادهٔ بازار', 'همیشه با ذکر منبع و بازهٔ زمانی'],
      ['جایگاه تبلیغاتی در محتوا', 'وجود ندارد'],
      ['واقعیت‌های شبکه', 'از کد برنامه ساخته می‌شود، نه تایپ دستی'],
      ['اصلاح‌ها', 'fbtswap@gmail.com، با نشانی صفحه و ادعا']
    ],
    faqs: [
      {
        q: 'چرا صفحه‌ای دربارهٔ اینکه کدام ارز بالا می‌رود وجود ندارد؟',
        a: 'چون مجبور بودیم از خودمان دربیاوریم. این محصول قیمت پیش‌بینی نمی‌کند و قواعد تحریریه اجازه نمی‌دهد صفحه‌ای دانشی را القا کند که هیچ‌کس ندارد. راهنمای اندازهٔ موقعیت و ریسک مفید است؛ پیش‌بینی نیست.'
      },
      {
        q: 'این راهنماها برای رتبه‌گرفتن در جست‌وجو نوشته شده‌اند؟',
        a: 'برای پاسخ کامل به یک پرسش واقعی نوشته شده‌اند و در خوشه‌های موضوعی سازمان یافته‌اند تا پاسخ‌ها به هم پیوند بخورند. همین ساختار در جست‌وجو کمک می‌کند چون ساختار یک اثر مرجع است — مفید بودن خودِ راهبرد است، نه اثر جانبی آن.'
      }
    ]
  }),

  article({
    slug: 'fa/trust/contact-and-verification',
    cluster: C,
    lang: 'fa',
    icon: 'alert',
    title: 'تماس و اینکه چطور مطمئن شوی واقعاً ما هستیم | FBT Swap',
    description:
      'یک دامنه، یک نشانی ایمیل و هرگز تماس ابتدایی. چطور بررسی کنی روی سایت واقعی هستی و جعل هویت را پیش از هزینه‌دار شدن تشخیص بدهی.',
    h1: 'تماس، و اینکه چطور مطمئن شوی واقعاً ما هستیم',
    intro: [
      'جعل هویت مؤثرترین حمله علیه کاربران هر محصول کریپتویی است و به شکستن هیچ چیز فنی نیاز ندارد. به یک نام نمایشی باورپذیر و کاربری عجول نیاز دارد. دفاع، تعداد کمی واقعیت است که آن‌قدر محکم نگه داشته شوند که پیامی قانع‌کننده نتواند تکانشان بدهد.',
      'یک دامنهٔ رسمی وجود دارد، یک نشانی تماس، و یک قاعده دربارهٔ اینکه چه کسی گفت‌وگو را شروع می‌کند. این سه واقعیت در ادامه آمده‌اند و استثنا ندارند.'
    ],
    sections: [
      [
        'سه واقعیت',
        [
          'تنها دامنهٔ رسمی fbtswap.ir است. نه نسخه‌ای با خط تیره، نه پسوندی دیگر، نه شبیه‌سازی با حرفی جایگزین‌شده. خودت تایپش کن یا از نشانکی استفاده کن که خودت ساخته‌ای؛ نتیجهٔ جست‌وجو و لینک داخل پیام هر دو جاهایی‌اند که نسخهٔ جعلی می‌تواند بالاتر از اصلی بنشیند.',
          'تنها نشانی تماس fbtswap@gmail.com است. و قاعده‌ای که آن دو را قابل استفاده می‌کند: ما هرگز اول با کاربر تماس نمی‌گیریم. نه با پیام مستقیم، نه تلفنی، نه با ایمیل. پیامی که بدون درخواست تو برسد و ادعا کند ما هستیم، ما نیست، هرچقدر هم خوب نوشته شده باشد.'
        ]
      ],
      [
        'چیزی که هرگز نمی‌خواهیم',
        [
          'عبارت بازیابی یا کلید خصوصی، تحت هیچ شرایطی. جلسهٔ دسترسی از راه دور یا اشتراک صفحه. انتقال به آدرس «امن» یا «تأیید». پرداختی برای آزادسازی یا بازیابی وجوه. هر کدام از این‌ها در حمله‌های واقعی دیده می‌شود و هر کدام قطعی است: خودِ درخواست همان اثبات است.',
          'هیچ ایردراپ، هدیه یا مهاجرت مشروعی هم وجود ندارد که به عبارت بازیابی نیاز داشته باشد. کل این دسته طعمه است و کار می‌کند چون درست وقتی می‌رسد که کسی از قبل سر چیز دیگری هیجان‌زده است.'
        ]
      ],
      [
        'اگر از قبل با تو تماس گرفته‌اند',
        [
          'پاسخ نده. روی هیچ‌چیز داخل پیام کلیک نکن، حتی لینک لغو اشتراک. اگر کیف پولت را به سایتی وصل کرده‌ای که حالا به آن شک داری، فوراً مجوزهایش را باطل کن به‌جای اینکه منتظر بمانی ببینی اتفاقی می‌افتد یا نه، چون یک مجوز هر زمان دیگری هم قابل استفاده است.',
          'اگر عبارت بازیابی را جایی غیر از کیف پول خودت وارد کرده‌ای، آن کیف پول را در خطر بدان و باقی‌مانده را به کیف پول تازه‌ساخته‌شده منتقل کن. اینجا سرعت از اطمینان مهم‌تر است؛ کیف پولی که بی‌دلیل از آن خارج شوی کمی کارمزد شبکه هزینه دارد و گزینهٔ دیگر همه‌چیز را.'
        ]
      ],
      [
        'راه درست تماس با ما',
        [
          'به fbtswap@gmail.com ایمیل بزن. برای مسئلهٔ امنیتی، دامنهٔ کار و نشانی تماس در فایل security.txt روی مسیر استاندارد هم طبق RFC 9116 منتشر شده است. نشانی صفحه و توضیح مشخص را بنویس — همین تفاوت گزارشی است که می‌توانیم رویش کار کنیم با گزارشی که نمی‌توانیم.',
          'کاری که با ایمیل از ما برنمی‌آید بازیابی وجوه، برگرداندن تراکنش یا احیای عبارت گمشده است. این محدودیت‌ها به‌طور کامل در صفحهٔ محدودیت‌ها توضیح داده شده‌اند و فرقی نمی‌کند درخواست از چه راهی برسد.'
        ]
      ]
    ],
    facts: [
      ['دامنهٔ رسمی', 'fbtswap.ir — تنها دامنه'],
      ['نشانی تماس', 'fbtswap@gmail.com — تنها نشانی'],
      ['تماس ابتدایی از سوی ما', 'هرگز رخ نمی‌دهد'],
      ['درخواست عبارت بازیابی', 'همیشه حمله است، بدون استثنا'],
      ['گزارش امنیتی', 'security.txt روی مسیر استاندارد، RFC 9116']
    ],
    faqs: [
      {
        q: 'کسی در پیام‌رسان می‌گوید پشتیبانی اف‌بی‌تی سواپ است. درست می‌گوید؟',
        a: 'نه. ما حساب پشتیبانی روی پیام‌رسان‌ها نداریم و هرگز گفت‌وگو را شروع نمی‌کنیم. تنها مسیر تماس ایمیل به fbtswap@gmail.com است، آن هم وقتی خودت شروع کنی.'
      },
      {
        q: 'چطور مطمئن شوم روی سایت واقعی هستم؟',
        a: 'کل دامنه را با دقت بخوان — fbtswap.ir است و هیچ‌چیز دیگر — و از نشانک خودت به آن برس، نه از لینک یا تبلیغ. دامنه‌های شبیه‌سازی‌شده با حروف جایگزین دقیقاً برای جان‌سالم‌دربردن از یک نگاه سریع ساخته شده‌اند.'
      }
    ]
  })
,

  article({
    slug: 'fa/trust/press-kit',
    cluster: C,
    lang: 'fa',
    icon: 'grid',
    title: 'کیت رسانه‌ای — نام برند، متن آماده و واقعیت‌های قابل ارجاع | FBT Swap',
    description:
      'هر چیزی که برای نوشتن دقیق دربارهٔ اف‌بی‌تی سواپ لازم است: نام درست، متن آمادهٔ کپی، واقعیت‌های قابل ارجاع و ادعاهایی که خواهش می‌کنیم مطرح نکنی.',
    h1: 'کیت رسانه‌ای',
    intro: [
      'اگر دربارهٔ اف‌بی‌تی سواپ می‌نویسی، نقدش می‌کنی، در فهرستی ثبتش می‌کنی یا در پاسخی به آن ارجاع می‌دهی، این صفحه همان مطالبی را دارد که لازم داری، به شکلی که بتوانی کپی کنی. وجود دارد چون گزینهٔ دیگر این است که از روی صفحهٔ تبلیغاتی توصیف شویم، و نادرستی‌ها دقیقاً از همان‌جا می‌آیند.',
      'مهم‌ترین بخش، بخش آخر است. ادعاهای مشخصی هست که خواهش می‌کنیم از طرف ما مطرح نشوند، چون درست نیستند و چون محصولی که اجازه دهد خطاهای به‌نفعش باقی بمانند، دارد چیزی دربارهٔ باقی ادعاهایش می‌گوید.'
    ],
    sections: [
      [
        'نام و هویت',
        [
          'نام محصول در انگلیسی FBT Swap است، دو کلمه با حرف بزرگ. شکل یک‌کلمه‌ای FBTSwap جایی پذیرفتنی است که فاصله ممکن نباشد، مثل نام کاربری. در فارسی «اف‌بی‌تی سواپ» نوشته می‌شود. شرکت گرداننده، فانوس بازار پیشگام مستقر در اصفهان ایران است و همان شخصیت حقوقی پشت محصول است.',
          'تنها دامنهٔ رسمی fbtswap.ir است و پیوند باید به همان‌جا اشاره کند، نه به آینه، کوتاه‌کنندهٔ لینک یا صفحهٔ فروشگاه برنامه. لوگو روی ریشهٔ سایت با نام icon-512.png و کارت اجتماعی با نام social-card.png سرو می‌شود. استفادهٔ تحریریه از این‌ها به اجازه نیاز ندارد.'
        ]
      ],
      [
        'متن آماده برای کپی',
        [
          'کوتاه: «اف‌بی‌تی سواپ یک رابط سواپ غیرحضانتی و برنامهٔ سبد دارایی برای اندروید و وب است که ۱۶ شبکهٔ EVM به‌همراه سولانا را به فارسی و انگلیسی پوشش می‌دهد.»',
          'بلند: «اف‌بی‌تی سواپ یک رابط سواپ غیرحضانتی و برنامهٔ سبد دارایی است که شرکت فانوس بازار پیشگام از اصفهان ایران آن را ساخته است. مسیرهای صرافی غیرمتمرکز عمومی را روی شانزده شبکهٔ EVM به‌همراه سولانا تجمیع می‌کند، کارمزد ۰٫۷۰ درصدی پلتفرم را روی مقدار ورودی سواپ می‌گیرد که پیش از امضا نمایش داده می‌شود، و هیچ‌گاه دارایی یا عبارت بازیابی کاربر را در اختیار نمی‌گیرد. فارسی و انگلیسی هر دو در این محصول زبان درجه‌یک‌اند.»'
        ]
      ],
      [
        'واقعیت‌های قابل ارجاع',
        [
          'هفده شبکهٔ پشتیبانی‌شده: شانزده زنجیرهٔ EVM به‌همراه سولانا. کارمزد ۰٫۷۰ درصدی پلتفرم روی مقدار ورودی، یکسان روی همهٔ شبکه‌ها و نمایش‌داده‌شده پیش از امضای کاربر. بدون نیاز به حساب، ایمیل یا مدرک هویتی برای رابط سواپ آن‌چین. بدون امانت‌داری دارایی و بدون دسترسی به عبارت بازیابی در هیچ مرحله‌ای.',
          'سه هزینهٔ جدا در یک سواپ با سه دریافت‌کنندهٔ جدا: کارمزد شبکه به زنجیره، کارمزد استخر داخل قیمت اعلام‌شده به تأمین‌کنندگان نقدینگی، و کارمزد پلتفرم به اف‌بی‌تی سواپ. هر شبکهٔ پشتیبانی‌شده صفحهٔ خودش را دارد با شناسهٔ زنجیره، توکن کارمزد و کاوشگر بلاک که از کد خود برنامه ساخته می‌شود تا این اعداد نتوانند از اعتبار بیفتند.'
        ]
      ],
      [
        'ادعاهایی که خواهش می‌کنیم مطرح نکنی',
        [
          'لطفاً اف‌بی‌تی سواپ را صرافی، کارگزار یا کیف پول توصیف نکن. این یک رابط برای صرافی‌های غیرمتمرکز شخص ثالث است؛ دفتر سفارش ندارد، نقدینگی نگه نمی‌دارد و کلید ذخیره نمی‌کند. لطفاً نگو بهترین قیمت موجود را می‌دهد — ادعای دقیق این است که بهترین مسیر میان محل‌های پرسیده‌شده در همان لحظه را می‌دهد.',
          'لطفاً آن را مصون از MEV، ناشناس، بیمه‌شده یا قادر به بازیابی وجوه از دست رفته توصیف نکن. مسیریابی قرارگیری در معرض حملهٔ ساندویچی را کم می‌کند بدون آنکه مصونیت بدهد. فعالیت روی زنجیره عمومی است و هیچ رابطی این را تغییر نمی‌دهد. بیمه‌ای وجود ندارد و سرویس غیرحضانتی نمی‌تواند چیزی را برگرداند، مسدود کند یا احیا کند. ترجیح می‌دهیم دقیق و کم‌هیجان‌تر توصیف شویم.'
        ]
      ]
    ],
    facts: [
      ['نام درست', 'اف‌بی‌تی سواپ / FBT Swap'],
      ['شخصیت حقوقی', 'شرکت فانوس بازار پیشگام، اصفهان، ایران'],
      ['مقصد پیوند', 'https://fbtswap.ir — تنها دامنهٔ رسمی'],
      ['لوگو و کارت اجتماعی', 'فایل‌های icon-512.png و social-card.png'],
      ['تماس رسانه‌ای', 'fbtswap@gmail.com']
    ],
    faqs: [
      {
        q: 'برای استفاده از لوگو یا نوشتن دربارهٔ اف‌بی‌تی سواپ به اجازه نیاز دارم؟',
        a: 'برای استفادهٔ تحریریه، نقد یا ثبت در فهرست به اجازه نیاز نیست. فقط خواهش می‌کنیم نام درست نوشته شود، پیوند به fbtswap.ir اشاره کند و از ادعاهای بخش آخر این صفحه پرهیز شود.'
      },
      {
        q: 'می‌توانید نقل‌قول یا دسترسی برای بررسی بدهید؟',
        a: 'به fbtswap@gmail.com ایمیل بزن. محصول روی fbtswap.ir بدون نیاز به حساب کاربری باز است، پس می‌توانی پیش از هر پرسشی خودت رابط سواپ را ارزیابی کنی — که مبنای بهتری برای نقد است تا یک بیانیهٔ آماده.'
      }
    ]
  })
];

export const TRUST_PAGES = [...en, ...fa];
