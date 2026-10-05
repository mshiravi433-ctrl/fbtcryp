/** CLUSTER: wallets, keys & custody — 12 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'what-is-a-seed-phrase',
    cluster: 'wallets',
    icon: 'key',
    title: 'What a Seed Phrase Really Is (and Why It Cannot Be Reset)',
    description:
      'Twelve or twenty-four words encode the master key for every account in a wallet. What they derive, why nobody can recover them, and how to store them.',
    h1: 'Your seed phrase is the wallet, not a password',
    intro: [
      'A recovery phrase is not a login credential and not a backup of an account. It is a human-readable encoding of a random number from which every private key in that wallet is deterministically derived.',
      'This single fact explains everything that follows: why anyone holding the words holds the funds, why there is no reset, and why a support agent asking for them is always an attacker.'
    ],
    sections: [
      ['From words to keys', [
        'The words come from a fixed list of 2048 and encode entropy plus a checksum. That entropy becomes a master seed, the seed becomes a master key, and standard derivation paths turn that into an effectively unlimited number of accounts across multiple chains.',
        'Because the derivation is deterministic, the same phrase in a different wallet app reproduces the same addresses — provided the app uses the same derivation path, which is the usual reason an imported wallet appears empty.'
      ]],
      ['Why nobody can recover it', [
        'There is no registry mapping phrases to people. The blockchain only ever sees signatures, and a signature proves possession of a key without revealing who holds it. There is no account record to reset because there is no account.',
        'This is the cost of self-custody and it is not negotiable. The same property that stops anyone freezing your funds stops anyone restoring them.'
      ]],
      ['Storage that survives real life', [
        'The threats are theft, fire, water, loss and your own forgetfulness — and the common failure is optimising for one and ignoring the rest. A photograph on a phone is convenient and is also the single most commonly drained storage method.',
        'Write it on paper and store it somewhere only you can reach, or stamp it into metal if the amount justifies it. Consider a second copy in a different physical location. Never type it into anything that is not the wallet application itself.'
      ]],
      ['The one rule that prevents most losses', [
        'Nobody legitimate will ever ask for it. Not support, not a validator, not an airdrop form, not a wallet migration page, not FBT Swap. There is no legitimate situation in which the phrase is typed anywhere except into a wallet you are restoring.',
        'If a page or a person asks for it, the request itself is the proof of fraud. Nothing else needs checking.'
      ]]
    ],
    facts: [
      ['What it encodes', 'Entropy plus a checksum; the master key for every derived account'],
      ['Word list', '2048 fixed words — a misspelling will not validate'],
      ['Recovery by others', 'Impossible. No registry, no account, no reset'],
      ['Safe to share', 'Never, with anyone, under any circumstances']
    ],
    faqs: [
      { q: 'Is a 24-word phrase safer than 12?', a: 'It encodes more entropy, but both are far beyond brute force with current technology. The realistic threat is someone reading your copy, not computing it, so storage quality matters more than word count.' },
      { q: 'I imported my phrase and the balance is missing. Why?', a: 'Almost always a different derivation path or a different account index, so the app generated different addresses from the same phrase. Check the path setting and the account list before assuming anything is lost.' },
      { q: 'Does FBT Swap ever see my recovery phrase?', a: 'No. When you connect an external wallet the phrase and keys never leave it. The optional in-app EVM wallet encrypts its phrase on your device with your password and does not transmit it.' }
    ]
  }),

  article({
    slug: 'hardware-wallet-guide',
    cluster: 'wallets',
    icon: 'shield',
    title: 'Hardware Wallets: What They Protect Against and What They Do Not',
    description:
      'A hardware wallet keeps the key off an internet-connected machine. It cannot save you from signing a malicious transaction you approved on its screen.',
    h1: 'What a hardware wallet actually defends',
    intro: [
      'A hardware wallet moves one thing out of reach: the private key never exists on your computer or phone, so malware on those devices cannot read it. That is a large and real improvement.',
      'It is also narrower than most people assume. The device signs whatever you confirm on its own screen, and a drained hardware wallet is almost always a correctly signed malicious transaction.'
    ],
    sections: [
      ['The threat it removes', [
        'Key extraction. Clipboard stealers, infostealers and compromised browser extensions can read a software wallet\'s encrypted store and attack the password offline. A hardware device never exposes the key material to the host at all.',
        'It also enforces a deliberate physical step. Every signature requires a button press on the device, so nothing can be signed silently in the background.'
      ]],
      ['The threat it does not remove', [
        'If you approve an unlimited allowance to a drainer contract, the hardware wallet will sign it, because that is exactly what you asked for. If you send to a poisoned address you copied from your own history, it will sign that too.',
        'The device protects the key. It does not protect the decision, which is why reading the screen it shows you is the entire remaining defence.'
      ]],
      ['Clear signing versus blind signing', [
        'A device that can decode the transaction shows you the token, the amount and the destination. A device asked to sign an opaque payload shows a hash and nothing else — that is blind signing, and it is where most hardware-wallet losses originate.',
        'Prefer wallets and chains where the device can display a human-readable summary, and treat a request to blind-sign as a reason to stop and verify independently.'
      ]],
      ['Buying and setting one up', [
        'Buy directly from the manufacturer. Supply-chain tampering with a pre-seeded device is a documented attack, and any device arriving with a recovery phrase already printed is fraudulent by definition — you generate the phrase, it does.',
        'Set a PIN, generate the phrase on the device, verify it on the device, and store it as physical media. FBT Swap connects to hardware wallets through your wallet application, so the signing step happens entirely on your device.'
      ]]
    ],
    facts: [
      ['Protects against', 'Key extraction by malware on your computer or phone'],
      ['Does not protect against', 'Malicious transactions you confirm on the device'],
      ['Highest risk setting', 'Blind signing an opaque payload'],
      ['Buy from', 'The manufacturer directly — never a marketplace reseller']
    ],
    faqs: [
      { q: 'Can a hardware wallet be hacked remotely?', a: 'The key material is designed never to leave the secure element, so remote extraction is not the realistic threat. The realistic threat is being persuaded to approve something harmful on the device itself.' },
      { q: 'What happens if I lose the device?', a: 'Nothing, provided you have the recovery phrase stored safely. Buy a replacement, restore from the phrase and the same accounts reappear. The device is replaceable; the phrase is not.' },
      { q: 'Is a hardware wallet worth it for a small balance?', a: 'The honest answer is that it depends on the amount against the cost. For small balances a well-maintained software wallet with careful signing habits is reasonable; the device becomes clearly worthwhile as the balance grows.' }
    ]
  }),

  article({
    slug: 'walletconnect-explained',
    cluster: 'wallets',
    icon: 'network',
    title: 'WalletConnect: What a Connection Does and Does Not Allow',
    description:
      'Scanning a QR code opens an encrypted session between a site and your wallet. It can request signatures. It cannot sign, and cannot move funds.',
    h1: 'What you agree to when you scan that QR code',
    intro: [
      'WalletConnect is a messaging channel, not a permission grant. It lets a website propose transactions to a wallet on another device, and lets the wallet send back signatures it produced itself.',
      'The distinction matters because people treat connecting as the dangerous step. It is not — the dangerous step is always what you approve afterwards.'
    ],
    sections: [
      ['How the session works', [
        'The site generates a pairing URI, your wallet reads it, and the two establish an end-to-end encrypted session through relay servers that cannot read the contents. The site learns the address and chain you approved for the session.',
        'From then on the site can send requests: switch chain, sign a message, send a transaction. Each one surfaces in your wallet as a prompt you must explicitly accept.'
      ]],
      ['What a connection reveals', [
        'Your public address and therefore your on-chain history and balances, which are public anyway. A site can read everything your address has ever done, because so can anybody with a block explorer.',
        'It does not reveal your private key, your recovery phrase or any other account in the same wallet that you did not approve.'
      ]],
      ['Where the real risk is', [
        'In the approval prompts. A malicious site connected over WalletConnect is exactly as dangerous as a malicious site in a browser extension wallet: it can request an unlimited allowance or a transfer, and it depends entirely on you reading the prompt.',
        'Signature requests deserve the same care as transactions. An off-chain signature can authorise a token transfer under permit-style standards without any on-chain approval step.'
      ]],
      ['Session hygiene', [
        'Disconnect sessions you are not using, from the wallet side. A long-lived session to a site you no longer visit costs nothing but adds a channel that can propose requests at any time.',
        'FBT Swap uses WalletConnect for external wallets and shows the chain and the proposed transaction before anything reaches your wallet. The signature always happens in your wallet, never here.'
      ]]
    ],
    facts: [
      ['What it is', 'An encrypted request channel between a site and your wallet'],
      ['It can', 'Propose transactions and signature requests'],
      ['It cannot', 'Sign anything, read your key, or move funds'],
      ['Real risk', 'Approving a harmful request — including off-chain signatures']
    ],
    faqs: [
      { q: 'Can a connected site drain my wallet?', a: 'Only if you approve a request that lets it. A connection alone grants no spending power; an unlimited token approval or a permit signature does, which is why the prompt is the thing to read.' },
      { q: 'Is the relay able to see my transactions?', a: 'The session payload is end-to-end encrypted between the site and the wallet, so the relay forwards ciphertext. Metadata such as timing and session existence is inherently visible to it.' },
      { q: 'Should I disconnect after every use?', a: 'It is good hygiene and costs nothing. At minimum, review active sessions periodically and remove ones belonging to sites you no longer use.' }
    ]
  }),

  article({
    slug: 'hot-vs-cold-wallet',
    cluster: 'wallets',
    icon: 'layers',
    title: 'Hot and Cold Wallets: Choosing by Threat, Not by Fashion',
    description:
      'Hot wallets are connected and convenient. Cold wallets are offline and deliberate. Most people need both, split by how much a mistake would cost.',
    h1: 'Hot, cold, and the split that actually works',
    intro: [
      'The categories are simple: a hot wallet holds keys on an internet-connected device, a cold wallet keeps them off one. The useful question is not which is better but which balance belongs on each.',
      'Treating it as a single choice produces either an uncomfortable amount of money on a browser extension or a hardware wallet you plug in so often it stops being cold.'
    ],
    sections: [
      ['What each is good at', [
        'Hot wallets are fast, free, and work anywhere. They are the right place for amounts you are actively trading and for interacting with new contracts, because the loss is bounded by what is in them.',
        'Cold storage is slow by design. That friction is the feature: it makes impulsive signing hard and keeps the key away from whatever is running on your laptop.'
      ]],
      ['The spending-account pattern', [
        'Keep a long-term wallet that never connects to an unfamiliar site and never grants an allowance. Keep a separate spending wallet funded with what you need for the week, and do all experimentation there.',
        'This bounds every category of loss at once: a drainer gets the spending wallet, a bad contract gets the spending wallet, a phishing signature gets the spending wallet.'
      ]],
      ['Where people get it wrong', [
        'Using a hardware wallet as a daily driver means signing dozens of approvals with it, which reintroduces exactly the risk it was bought to avoid. Conversely, keeping life savings in a browser extension because moving them is a hassle is a decision made by inertia.',
        'A third mistake is a single wallet with one recovery phrase and no separation at all, where any one mistake is total.'
      ]],
      ['Practical setup', [
        'Two wallets, two phrases, stored separately. Fund the spending wallet from the cold one when needed, never the reverse. Review allowances on the spending wallet regularly and simply abandon it if it is ever compromised.',
        'FBT Swap works with external wallets through WalletConnect or a browser wallet, and offers an encrypted in-app EVM wallet intended for small amounts — the in-app option is explicitly not the place for a significant balance.'
      ]]
    ],
    facts: [
      ['Hot wallet', 'Keys on a connected device; use for active, bounded amounts'],
      ['Cold wallet', 'Keys offline; use for balances you are not trading'],
      ['Pattern', 'Separate spending and storage wallets with separate phrases'],
      ['Failure mode', 'One wallet for everything — every mistake becomes total']
    ],
    faqs: [
      { q: 'Is a phone wallet hot or cold?', a: 'Hot. The phone is internet-connected, so the key is on a networked device. A phone with a secure enclave is meaningfully better than a browser extension, but it is not cold storage.' },
      { q: 'Can I use the same phrase for both wallets?', a: 'You can, and it defeats the purpose. Separation only limits damage if a compromise of one does not reveal the other, which requires distinct phrases.' },
      { q: 'How much should stay in the spending wallet?', a: 'An amount whose complete loss would be annoying rather than serious. That threshold is personal, and defining it explicitly is more useful than any fixed figure.' }
    ]
  }),

  article({
    slug: 'how-to-revoke-token-approvals',
    cluster: 'wallets',
    icon: 'shield',
    title: 'How to Review and Revoke Token Approvals',
    description:
      'Allowances persist forever unless you change them. How to list what you have granted, decide what to remove, and do it without falling for a fake revoker.',
    h1: 'Finding and removing the permissions you forgot',
    intro: [
      'Every token approval you have ever granted is still active unless you explicitly changed it. Contracts you used once in 2022 may still be authorised to move your entire balance of a token today.',
      'Reviewing them is the highest-value hour of security work available to most wallets, and it is free apart from gas.'
    ],
    sections: [
      ['Listing what you have granted', [
        'Allowances live on the token contract, so they are public. Block explorers for each network expose a token-approval view for an address, and dedicated revocation tools read the same data.',
        'Check every chain you have used. Approvals are per-chain, so a clean list on Ethereum says nothing about BNB Chain or Polygon.'
      ]],
      ['Deciding what to remove', [
        'Remove anything unlimited on a token with a meaningful balance unless you use that contract regularly. Remove everything belonging to a protocol you no longer use. Remove everything granted to a contract you cannot identify.',
        'Keeping a small number of allowances to long-lived, widely used routers is a reasonable trade. Keeping forty is not a trade, it is an inventory nobody is tracking.'
      ]],
      ['Revoking safely', [
        'A revocation sets the allowance to zero and is an ordinary on-chain transaction, so it costs gas on each chain. Batch it while gas is low rather than doing one at a time.',
        'Critically: fake revocation sites exist precisely because this is advice people follow. A page that asks you to connect and then requests an approval rather than a zeroing transaction is the attack wearing the costume of the defence.'
      ]],
      ['Making it a habit', [
        'Review after any period of heavy experimentation, after using any site you are unsure about, and on a fixed schedule — quarterly is enough for most people. Before a large balance arrives in a wallet is another good moment.',
        'FBT Swap requests approvals only for the token being swapped and only for the aggregator router executing it. The spender address is visible in your wallet prompt every time, which is the moment to notice anything unexpected.'
      ]]
    ],
    howTo: [
      ['Pick a chain', 'Approvals are per-network. Work through each chain your address has used.'],
      ['Open the approvals view', 'Use the block explorer for that chain, or a revocation tool you reached by typing the address yourself.'],
      ['Identify the spenders', 'Match each spender contract to a protocol you recognise. Anything unidentifiable is a candidate for removal.'],
      ['Revoke the unnecessary ones', 'Set the allowance to zero. Each revocation is a transaction and costs gas on that chain.'],
      ['Re-check the result', 'Reload the approvals view and confirm the allowance now reads zero before moving on.']
    ],
    facts: [
      ['Persistence', 'Allowances last until explicitly changed — there is no expiry'],
      ['Scope', 'Per token, per spender, per chain'],
      ['Cost', 'One gas-paying transaction per revocation'],
      ['Main trap', 'Fake revocation sites that request an approval instead']
    ],
    faqs: [
      { q: 'Does revoking move my tokens?', a: 'No. It only sets a spender\'s allowance to zero on the token contract. Your balance is untouched and the tokens never move.' },
      { q: 'Is there a free way to revoke?', a: 'No, because it is a state change on-chain and therefore a transaction with a network fee. Doing it on a low-fee chain or during a quiet window is the only saving available.' },
      { q: 'Will I have to re-approve later?', a: 'Yes, if you use that protocol again. That is the intended trade: a small recurring cost in exchange for not leaving standing permissions open indefinitely.' }
    ]
  }),

  article({
    slug: 'smart-contract-wallets-and-account-abstraction',
    cluster: 'wallets',
    icon: 'code',
    title: 'Smart Contract Wallets and Account Abstraction, Plainly',
    description:
      'A smart account is a contract that owns your funds and enforces your rules: social recovery, spending limits, sponsored gas and batched transactions.',
    h1: 'When your wallet is a contract instead of a key',
    intro: [
      'An ordinary account is a key pair and nothing else. Its rules are fixed by the protocol: one signature, one transaction, gas paid in the native coin, no recovery.',
      'A smart contract wallet replaces that with programmable logic. The trade is new capabilities in exchange for new trust assumptions and a deployment cost.'
    ],
    sections: [
      ['What becomes possible', [
        'Social recovery, where a set of guardians can rotate the signing key if you lose it. Spending limits and allow-lists enforced by the account itself. Batched operations, so an approval and a swap are one atomic transaction. Sponsored gas, where a paymaster pays and bills you another way.',
        'Session keys are another: a temporary key with narrow permissions that expires, which is a genuinely better model than an unlimited standing allowance.'
      ]],
      ['What it costs', [
        'Deployment is a transaction. Every operation is more gas than an ordinary account, because contract logic runs on each one. And the account is code, which means its security is the security of that code plus whoever can upgrade it.',
        'A bug in a smart account is a different and more serious failure than a bug in a wallet interface, because the funds are held by the contract.'
      ]],
      ['The trust questions to ask', [
        'Who can upgrade the contract, and is that controlled by a key, a multisig or a timelock? What happens to your funds if the provider disappears — can you still move them with only your own signer? Has the code been audited, and is the deployed bytecode the audited version?',
        'A smart account whose provider can unilaterally upgrade it is closer to custody than its marketing suggests.'
      ]],
      ['Where this stands today', [
        'Account abstraction is real and usable on most EVM networks, with wallets offering recovery and batching as standard features. It is not universal, and some protocols still assume a plain key account.',
        'FBT Swap connects to whatever the wallet exposes. If your wallet is a smart account, the transaction it signs is routed the same way; the difference is in how your wallet constructs and authorises it.'
      ]]
    ],
    facts: [
      ['What it is', 'A contract that holds funds and enforces programmable rules'],
      ['Gains', 'Recovery, limits, batching, session keys, sponsored gas'],
      ['Costs', 'Deployment fee, higher per-operation gas, contract risk'],
      ['Key question', 'Who can upgrade it, and can you exit without them']
    ],
    faqs: [
      { q: 'Does a smart account mean I no longer need a seed phrase?', a: 'It can, if recovery is handled by guardians instead. You then depend on the guardian set and the contract logic rather than on a phrase, which is a different risk, not an absent one.' },
      { q: 'Are smart accounts safer than ordinary wallets?', a: 'They remove some failure modes and add others. Spending limits and recovery are genuine improvements; contract bugs and upgrade keys are genuine new exposures. Safer depends on the specific implementation.' },
      { q: 'Can I use one on every network?', a: 'Most EVM networks support the standard, but the account must be deployed on each chain and its address may differ. Solana uses a different account model entirely.' }
    ]
  }),

  article({
    slug: 'multi-sig-wallets-explained',
    cluster: 'wallets',
    icon: 'grid',
    title: 'Multisig Wallets: Shared Control Without Shared Trust',
    description:
      'A multisig needs several signatures to move funds. How thresholds work, why they protect against one compromised key, and how they go wrong.',
    h1: 'Multisig removes the single point of failure',
    intro: [
      'A multisig wallet is a contract that executes only when a threshold of designated signers have approved — two of three, three of five, whatever you configure.',
      'It solves a specific problem precisely: one compromised key is no longer enough to lose everything. It introduces coordination costs and some failure modes of its own.'
    ],
    sections: [
      ['How a threshold works', [
        'Signers propose a transaction; other signers approve it; when the threshold is met, anyone can execute it. The contract enforces the count, so no signer can act alone and no off-chain agreement is needed.',
        'Thresholds should tolerate loss as well as compromise. Two of three survives one lost key and one stolen key; two of two survives neither.'
      ]],
      ['What it genuinely protects', [
        'Key theft, device loss, and insider risk in a team. It also creates a deliberate review step, which catches mistakes as often as attacks — a wrong address proposed by one person is usually spotted by the second.',
        'For organisations holding funds, it is close to a baseline requirement rather than an enhancement.'
      ]],
      ['Where multisigs fail', [
        'Signer fatigue, where approvals become rubber stamps and the review value disappears. Key concentration, where three signers keep their keys on the same laptop. And the oldest one: everyone approving a transaction nobody actually decoded.',
        'There is also operational risk — losing enough keys to fall below the threshold makes funds permanently immovable, and that has happened to real treasuries.'
      ]],
      ['Using one in practice', [
        'Distribute signers across people, devices and locations. Use hardware wallets as signers. Document a recovery plan for a lost key before you need it. Keep the threshold high enough to matter and low enough to survive attrition.',
        'FBT Swap interacts with a multisig like any other wallet: the transaction is proposed to it, and execution happens when your signer set approves. The routing and quoting are unchanged.'
      ]]
    ],
    facts: [
      ['What it is', 'A contract requiring M of N signatures to execute'],
      ['Protects', 'Against one stolen key, one lost device, one bad actor'],
      ['Common choice', '2-of-3 for individuals, 3-of-5 upward for organisations'],
      ['Fatal mistake', 'Losing more keys than the threshold allows']
    ],
    faqs: [
      { q: 'Does a multisig slow down trading?', a: 'Yes, deliberately. Each transaction needs multiple approvals, which makes it unsuitable for active trading and well suited to treasury balances that should not move quickly.' },
      { q: 'Can I be my own multiple signers?', a: 'Yes, using separate devices — a hardware wallet, a phone and a laptop, for instance. It still protects against one device being compromised, though not against a situation that affects all of them.' },
      { q: 'What if a signer refuses to approve?', a: 'Nothing moves unless the threshold is reached. That is the intended behaviour, and it is why the threshold and signer set should be chosen with disagreement in mind.' }
    ]
  }),

  article({
    slug: 'wallet-addresses-and-checksums',
    cluster: 'wallets',
    icon: 'check',
    title: 'Crypto Addresses, Checksums and the Mistakes They Catch',
    description:
      'EVM addresses use mixed-case checksums; Solana uses base58. What each format catches, what it cannot, and why the same address works across EVM chains.',
    h1: 'Reading an address well enough to not lose money',
    intro: [
      'An address is a public identifier derived from a key. Getting one wrong is the most permanent mistake available in crypto, and the formats include safeguards precisely because of that.',
      'Those safeguards catch typing errors. They do not catch sending to a correct address that belongs to the wrong person or the wrong chain, which is the error that actually costs people money.'
    ],
    sections: [
      ['EVM addresses and the capitalisation trick', [
        'An EVM address is twenty bytes shown as forty hexadecimal characters. The mixed capitalisation you see is not cosmetic — it encodes a checksum, so a wallet can detect a mistyped character that would otherwise look valid.',
        'An all-lowercase address is still accepted by most tools, which means the check is skipped. Preferring the checksummed form is a free safety margin.'
      ]],
      ['Why the same address works on many chains', [
        'Every EVM network derives addresses the same way, so one key produces the same address on Ethereum, BNB Chain, Polygon, Arbitrum and the rest. This is convenient and is also the source of the worst mistake in crypto.',
        'The address being valid on the destination chain does not mean the token exists there or that anyone controls it there. Sending a token to a correct-looking address on the wrong network usually means it is gone.'
      ]],
      ['Solana is a different format entirely', [
        'Solana addresses are base58-encoded 32-byte public keys — no 0x prefix, mixed case by nature, and typically 32 to 44 characters. An EVM address is not valid on Solana and vice versa.',
        'Solana also has associated token accounts, so the address you send a token to is derived from your wallet address and the mint. Wallets handle this, but it is why a token balance can need an account created before it can be received.'
      ]],
      ['Habits that prevent the permanent mistake', [
        'Verify the first and last several characters and at least one group in the middle — address poisoning attacks specifically target people who only check the ends. Send a small test amount for a first transfer to a new destination.',
        'Confirm the network on both sides, every time. FBT Swap shows the selected network before each signature for exactly this reason.'
      ]]
    ],
    facts: [
      ['EVM format', '0x plus 40 hex characters; capitalisation is a checksum'],
      ['Solana format', 'Base58, no prefix, usually 32–44 characters'],
      ['Same address', 'Valid across all EVM chains — which is the danger, not a feature'],
      ['Checksums catch', 'Typos only. Never a wrong but valid destination']
    ],
    faqs: [
      { q: 'Can I recover tokens sent to the wrong network?', a: 'Sometimes, if you control the same address on the destination chain and the token exists there — you may be able to add it manually. If the address is a contract or an exchange deposit that does not support that chain, it is usually permanent.' },
      { q: 'Why do wallets reject an address that looks correct?', a: 'Usually a checksum failure from a single altered character, or a format mismatch — an EVM address pasted into a Solana field, for example. Both are the safeguard working.' },
      { q: 'Are ENS-style names safer?', a: 'They remove transcription errors but add a resolution step that can itself be attacked or expire. Verify the resolved address the first time you use a name, and treat a changed resolution as a reason to stop.' }
    ]
  }),

  article({
    slug: 'how-to-back-up-a-crypto-wallet',
    cluster: 'wallets',
    icon: 'book',
    title: 'Backing Up a Crypto Wallet So It Survives Real Life',
    description:
      'Fire, flood, theft, loss and forgetfulness are the real threats. A backup plan that handles all five, plus the mistakes that quietly fail.',
    h1: 'A backup that survives more than one kind of disaster',
    intro: [
      'Most wallet backups are optimised against a single threat, usually theft, and fail completely against the others. One paper copy in a safe is excellent against hackers and useless against a house fire.',
      'A plan worth the name survives loss, destruction, theft and your own memory, without creating a new single point of failure.'
    ],
    sections: [
      ['The five threats, named', [
        'Theft of the backup. Destruction by fire or water. Loss through moving house or forgetting the location. Inheritance — nobody else knows it exists. And degradation, where ink fades or a cheap medium fails.',
        'A good plan has an explicit answer for each. If you cannot say what happens in each case, the plan is one scenario wide.'
      ]],
      ['Media that actually lasts', [
        'Paper in a sealed container is fine indoors and bad in a flood. Stamped or engraved metal survives fire and water and is the standard answer for meaningful amounts. Both are vulnerable to someone finding them.',
        'What does not work: a photo in a cloud gallery, a note in a password manager you also use for email, an encrypted file whose password you will not remember in five years, or a text message to yourself.'
      ]],
      ['Geographic separation without duplication risk', [
        'Two copies in two locations halves the chance of destruction and doubles the surfaces available to a thief. Splitting the phrase across locations sounds clever and usually produces an unrecoverable backup, because partial phrases are far less useful than people assume.',
        'A more reliable approach for larger amounts is a multisig with geographically separated signers, which is designed for exactly this problem.'
      ]],
      ['Testing and succession', [
        'An untested backup is a hypothesis. Restore it into a fresh wallet application once, confirm the first address matches, then wipe that installation. Doing this when nothing is wrong is far better than doing it for the first time in an emergency.',
        'Decide what happens if you are not around. A sealed instruction with a trusted person, or a legal arrangement, is the difference between an inheritance and a permanently frozen balance.'
      ]]
    ],
    howTo: [
      ['Write it by hand', 'Record the words in order, on durable media, away from any camera. Never type them into a connected device.'],
      ['Add the derivation detail', 'Note the wallet type and derivation path alongside the words so a future restore finds the same addresses.'],
      ['Store in two places', 'Two copies, two locations, both physically secured. Avoid splitting the phrase itself.'],
      ['Test the restore', 'Import into a clean wallet install, verify the first address matches, then remove that installation.'],
      ['Plan for succession', 'Leave sealed instructions with someone you trust, or arrange it formally, so the backup is findable without being exposed.']
    ],
    facts: [
      ['Threats to cover', 'Theft, fire, flood, loss, forgetting, inheritance'],
      ['Best media', 'Stamped metal for durability; paper is acceptable indoors'],
      ['Never', 'Photos, cloud notes, email drafts, chat messages'],
      ['Untested backup', 'Not a backup. Verify a restore while nothing is wrong']
    ],
    faqs: [
      { q: 'Is an encrypted digital backup acceptable?', a: 'It can be, if the encryption is strong, the password is stored separately and durably, and the file exists in more than one place. In practice the forgotten password is the failure mode, which is why physical media remains the default advice.' },
      { q: 'Should I add a passphrase to my seed?', a: 'An extra passphrase creates a separate hidden wallet and genuinely improves security against someone finding the words. It also becomes a second thing you can lose, with no recovery, so it demands the same backup discipline.' },
      { q: 'Can FBT Swap help me restore a wallet?', a: 'No. We never see your phrase and have no record of your accounts. Restoration happens entirely in your own wallet application from your own backup.' }
    ]
  }),

  article({
    slug: 'recover-crypto-wallet-access',
    cluster: 'wallets',
    icon: 'history',
    title: 'Lost Access to a Crypto Wallet: What Can and Cannot Be Done',
    description:
      'A forgotten password, a wrong derivation path and a lost phrase are three different problems. Two are often solvable. One never is.',
    h1: 'Three kinds of lost access, and which are recoverable',
    intro: [
      'People describe all of these as "losing a wallet", which is why the advice they receive is so often useless. They are distinct situations with very different odds.',
      'Diagnosing which one you are in is the first useful step, and it also tells you immediately whether anyone offering to help is lying.'
    ],
    sections: [
      ['Case one: you have the phrase but the app will not open', [
        'This is the easy case. The application password is local and unlocks a local encrypted store; the phrase is the actual wallet. Install any compatible wallet, restore from the phrase, and the accounts return.',
        'Nothing is lost here. The password only ever protected a copy.'
      ]],
      ['Case two: you restored but the balance is missing', [
        'Almost always a derivation path or account index mismatch, where the same phrase produced different addresses in the new application. Check the path setting, scan additional account indices, and compare an address you remember.',
        'Occasionally it is a network issue instead — the balance is on a chain the wallet has not added. Check the explorer for the address directly before concluding anything.'
      ]],
      ['Case three: the phrase is gone', [
        'There is no recovery. No company, no court and no cryptographic technique can reproduce a key from nothing, and the blockchain holds no identity record to appeal to.',
        'This is the hard, unqualified answer. Every service claiming otherwise is a fraud, and they are numerous because the desperation is real.'
      ]],
      ['The recovery-scam pattern', [
        'They appear within hours of any public mention of a loss. They ask for the phrase "to verify", or an upfront fee, or remote access to your machine. Some impersonate the wallet vendor; some impersonate law enforcement.',
        'FBT Swap will never contact you first, never ask for a recovery phrase and cannot restore access to anything. Any message claiming otherwise is an impersonation regardless of how convincing the branding looks.'
      ]]
    ],
    facts: [
      ['Forgotten app password', 'Recoverable with the phrase — reinstall and restore'],
      ['Missing balance after restore', 'Usually a derivation path or account index mismatch'],
      ['Lost recovery phrase', 'Not recoverable by anyone, ever'],
      ['Recovery services', 'Fraud. Without exception for a genuinely lost phrase']
    ],
    faqs: [
      { q: 'Can a brute-force tool find my phrase if I remember most of it?', a: 'If only one or two words are uncertain and you know the order, the search space is small enough that specialised tooling can sometimes help. If several words or the order are unknown, it is computationally hopeless.' },
      { q: 'My funds are visible on the explorer — does that mean they are recoverable?', a: 'No. Visibility is not access. The explorer shows public state; moving anything requires the private key, and nothing about seeing the balance brings that back.' },
      { q: 'Should I report a loss to the police?', a: 'If it was theft rather than loss, yes — a report is sometimes necessary for exchanges to act on frozen deposits. For a genuinely lost phrase, there is no party to act against.' }
    ]
  }),

  article({
    slug: 'browser-extension-wallet-safety',
    cluster: 'wallets',
    icon: 'privacy',
    title: 'Browser Wallet Safety: The Extension Is the Attack Surface',
    description:
      'Fake extensions, malicious updates, clipboard hijacking and over-permissioned add-ons. How a browser wallet gets compromised and how to harden it.',
    h1: 'Hardening the wallet that lives in your browser',
    intro: [
      'A browser wallet is the most convenient way to use decentralised applications and the most exposed place to keep a key. It runs inside the same program you use for everything else, alongside whatever else you have installed.',
      'The risks are specific and so are the mitigations. None of them require giving up the convenience entirely.'
    ],
    sections: [
      ['Installing the real thing', [
        'Fake wallet extensions appear in official stores regularly, sometimes with convincing review counts. Install only from the link on the project\'s own site, and check the publisher and install count before adding it.',
        'An extension that asks you to import a phrase immediately on install, before you have created anything, is the clearest possible warning sign.'
      ]],
      ['Other extensions are part of your threat model', [
        'Any extension with permission to read page content can see what you are doing, and some can modify it. A compromised or sold-on extension — a common fate for popular free ones — inherits that access.',
        'Audit your installed list. Remove anything you do not use. Consider a dedicated browser profile, or a separate browser entirely, used only for wallet activity.'
      ]],
      ['Clipboard and page-level attacks', [
        'Clipboard hijackers replace a copied address with the attacker\'s. Overlay attacks render a fake approval dialog on top of a real page. Both are defeated by verifying the address in your wallet\'s own prompt rather than on the website.',
        'The wallet prompt is rendered by the extension, not by the page, which is why it is the authoritative view of what you are about to sign.'
      ]],
      ['Sensible limits', [
        'Keep the browser wallet as a spending account. Use a hardware wallet as the signer for anything significant — the extension then becomes an interface rather than a key store. Lock the wallet when you walk away, and keep the browser updated.',
        'FBT Swap works with browser wallets and with hardware wallets through them. In either case the signing prompt comes from your wallet, and that prompt is the thing worth reading.'
      ]]
    ],
    facts: [
      ['Install source', "Only the link on the project's own site"],
      ['Hidden risk', 'Every other extension with page-read permission'],
      ['Authoritative view', "The wallet's own prompt, never the web page"],
      ['Best hardening', 'Hardware signer plus a dedicated browser profile']
    ],
    faqs: [
      { q: 'Is a browser wallet safe for large amounts?', a: 'Not as a key store. Paired with a hardware wallet as the signer it becomes a reasonable interface for larger balances, because the key is no longer in the browser at all.' },
      { q: 'Can a website read my private key from the extension?', a: 'No. Pages interact through a restricted interface and cannot access key material. The realistic attack is persuading you to approve something, or compromising the extension itself.' },
      { q: 'Does a separate browser profile really help?', a: 'Yes, meaningfully. It isolates the wallet from unrelated extensions, cookies and sessions, and makes it much harder for a compromised page in normal browsing to interact with your wallet context.' }
    ]
  }),

  article({
    slug: 'mobile-crypto-wallet-guide',
    cluster: 'wallets',
    icon: 'wallet',
    title: 'Mobile Crypto Wallets: Stronger Hardware, Weaker Habits',
    description:
      'Phones have secure enclaves and biometrics, and are also lost, shoulder-surfed and installed with fake apps. What to configure before funding one.',
    h1: 'Making a phone wallet genuinely safe to use',
    intro: [
      'A modern phone is better hardware for key storage than a laptop. Secure enclaves, enforced app sandboxing and biometric gates are real advantages over a browser extension.',
      'The weaknesses are behavioural and physical: phones are lost, screens are visible to the person behind you, and app stores carry convincing fakes.'
    ],
    sections: [
      ['Installing the right app', [
        'Fake wallet apps are a persistent problem in both major stores, often ranking for the real wallet\'s name. Reach the store through the link on the project\'s official site, then verify the developer name and the install count.',
        'An app that asks for your recovery phrase before letting you create a new wallet is malicious. There is no legitimate reason for that order.'
      ]],
      ['Device settings that matter', [
        'A strong device passcode, not a four-digit PIN. Biometric unlock for the wallet app itself. Automatic screen lock on a short timer. Disabled lock-screen notification previews, so a recovery code or transaction alert is not readable to anyone holding the phone.',
        'Keep the operating system current. Most practical mobile compromises use vulnerabilities that were patched months earlier.'
      ]],
      ['Physical and shoulder risk', [
        'The realistic threat for a phone wallet is someone taking the unlocked device, or watching you enter a PIN before doing so. Both are solved by the lock timer and by never entering a recovery phrase in a public place.',
        'If a phone is lost, the key is protected by the device lock, and your recovery phrase lets you restore elsewhere immediately. Having that phrase stored somewhere other than the phone is the entire plan.'
      ]],
      ['Connecting to applications', [
        'Mobile wallets connect to sites via WalletConnect or an in-app browser. Both surface approval prompts in the wallet, and those prompts are the authoritative view of what you are signing — not the page behind them.',
        'FBT Swap runs as a web app, an installable progressive web app and an Android build. In all three, the signature happens in your own wallet, and the recovery phrase of an external wallet never reaches us.'
      ]]
    ],
    facts: [
      ['Advantage', 'Secure enclave storage and enforced app sandboxing'],
      ['Main risks', 'Fake apps, device theft while unlocked, shoulder surfing'],
      ['Configure', 'Strong passcode, biometric app lock, short auto-lock, no lock-screen previews'],
      ['Non-negotiable', 'The recovery phrase stored off the phone']
    ],
    faqs: [
      { q: 'Is a phone safer than a laptop for crypto?', a: 'For key storage, generally yes — enclave-backed storage and sandboxing are stronger than a desktop browser. For transaction review, a larger screen is easier to read carefully, which matters more than people expect.' },
      { q: 'Should I use biometrics or a PIN?', a: 'Biometrics for convenience with a strong passcode behind them. The passcode is the real credential; a weak one undermines the biometric entirely, since the device can always fall back to it.' },
      { q: 'What if my phone is stolen with the wallet installed?', a: 'Provided the device is locked and the app requires authentication, the key is protected. Restore from your recovery phrase onto a new device, and move funds to a fresh wallet if you have any doubt about the old one.' }
    ]
  })
];
