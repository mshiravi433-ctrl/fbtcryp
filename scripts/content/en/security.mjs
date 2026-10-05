/** CLUSTER: security & scams — 12 English spokes. */
import { article } from '../schema.mjs';

export default [
  article({
    slug: 'wallet-drainer-scams',
    cluster: 'security',
    icon: 'alert',
    title: 'Wallet Drainers: How One Signature Empties an Account',
    description:
      'Drainer kits request an approval or a permit signature on a page that looks harmless. Nothing moves at first, which is exactly why they work.',
    h1: 'The signature that empties a wallet later',
    intro: [
      'A drainer does not break into anything. It persuades you to grant it permission, waits, and then uses that permission. The delay is deliberate — nothing appears to go wrong at the moment you are paying attention.',
      'These kits are sold as a service with hosting, templates and a cut of the proceeds, which is why the pages look professional and the social accounts promoting them look established.'
    ],
    sections: [
      ['The two signatures they want', [
        'An ERC-20 approval, which authorises a contract to move a specific token up to a limit. Or an off-chain permit signature, which does the same thing without an on-chain transaction and therefore without a gas prompt — making it feel even less consequential.',
        'A permit request is especially dangerous because it looks like "sign in with your wallet". It is not a login. It is a transferable authorisation.'
      ]],
      ['The pages they use', [
        'Airdrop claim pages, NFT mints with a countdown, token migration notices, "your wallet is at risk, revoke here" pages, and staking dashboards that mirror a real protocol. The last category is effective because the real protocol does need an approval.',
        'Traffic comes from advertisements on search results, replies to popular posts, compromised Discord servers and direct messages. Rarely from somewhere you navigated to yourself.'
      ]],
      ['Reading the prompt properly', [
        'Your wallet shows the token, the spender address and the amount. Three questions: does this site need this token at all, do I recognise this spender, and why is the amount unlimited? A mismatch on any of them ends the interaction.',
        'For signature requests, read the message. If it contains a spender, a token and a deadline, it is a permit, not a login, no matter what the button says.'
      ]],
      ['After a compromise', [
        'Move remaining assets to a fresh wallet with a new phrase immediately — revoking first wastes time the attacker is using. Then revoke the allowances on the old address so anything arriving there later is not swept.',
        'Treat the old address as public. Assume any permission granted from it is still live, and do not reuse it.'
      ]]
    ],
    facts: [
      ['Mechanism', 'An approval or permit signature you grant, used later'],
      ['Why it works', 'Nothing moves at signing time, so nothing looks wrong'],
      ['Check', 'Token, spender address and amount in your wallet prompt'],
      ['After', 'Move funds to a new wallet first, revoke second']
    ],
    faqs: [
      { q: 'Can a site drain me without any signature?', a: 'No. Every transfer requires a signature from your key. What varies is how innocuous the request is made to look, which is why reading the prompt is the entire defence.' },
      { q: 'Is a signature request safe because it costs no gas?', a: 'No — that is precisely the danger. Permit-style signatures authorise token movement off-chain with no gas prompt, so they feel lighter than they are.' },
      { q: 'Would FBT Swap ever ask for an unlimited approval on a page I did not reach myself?', a: 'FBT Swap only requests an approval for the token you are swapping, for the aggregator router that will execute it, at the moment you initiate the swap. We never message you first and have one domain: fbtswap.ir.' }
    ]
  }),

  article({
    slug: 'address-poisoning-attack',
    cluster: 'security',
    icon: 'privacy',
    title: 'Address Poisoning: The Attack That Uses Your Own History',
    description:
      'An attacker sends a dust transfer from an address resembling one you use, so it appears in your history. Later you copy theirs by mistake.',
    h1: 'Why your transaction history is an attack surface',
    intro: [
      'Address poisoning requires no permission, no signature and no interaction from you. The attacker simply sends something to your address from a lookalike, and waits for you to copy the wrong entry out of your own history.',
      'It works because almost everyone verifies addresses by checking the first and last few characters, and vanity-generation makes matching those trivially cheap.'
    ],
    sections: [
      ['How the lookalike is made', [
        'Generating keys until the address starts and ends with chosen characters takes minutes on ordinary hardware. The middle is different, but almost nobody reads the middle.',
        'The attacker then sends a tiny amount, a worthless token, or a zero-value transfer that still appears in your history. Some wallets display these indistinguishably from your real transactions.'
      ]],
      ['The moment it pays off', [
        'Weeks later you send to that destination again and copy the address from your recent activity rather than from the original source. The first six and last four characters match, so it looks right.',
        'The transfer is valid, irreversible and goes to the attacker. There is no contract involved and nothing for a security tool to flag.'
      ]],
      ['Defending against it', [
        'Never copy an address from transaction history. Use a saved address book entry you created deliberately, or re-obtain the address from its original source each time.',
        'When you do verify, check characters from the middle as well as the ends. And for any first transfer to a new destination, send a small test amount and confirm receipt before the real one.'
      ]],
      ['Why wallets struggle to stop it', [
        'The dust transfer is a valid transaction to your address. A wallet can hide zero-value transfers and flag unknown senders, and good ones increasingly do, but it cannot refuse to display your own history.',
        'This is a human-interface attack rather than a cryptographic one, which is why the countermeasure is a habit rather than a setting.'
      ]]
    ],
    facts: [
      ['Requires from you', 'Nothing. The dust arrives unsolicited'],
      ['Exploits', 'Copying an address out of your own transaction history'],
      ['Defence', 'Address book entries, full-string verification, test transfers'],
      ['Reversibility', 'None. It is an ordinary valid transfer to the wrong place']
    ],
    faqs: [
      { q: 'Is receiving dust dangerous by itself?', a: 'No. Receiving a token cannot compromise a wallet. The danger is entirely in what you do afterwards — copying the sender\'s address, or interacting with a token contract the dust points you toward.' },
      { q: 'Should I send the dust back?', a: 'No. It costs gas, confirms your address is active, and interacting with an unknown token contract can expose you to further tricks. Ignore and hide it.' },
      { q: 'Do address books fully solve this?', a: 'They solve the copy-from-history problem, which is the main one. You still need to verify the address correctly the first time you save it.' }
    ]
  }),

  article({
    slug: 'fake-token-contracts',
    cluster: 'security',
    icon: 'alert',
    title: 'Fake Tokens: Why the Symbol Means Nothing',
    description:
      'Anyone can deploy a token called USDC, ETH or any project name. Only the contract address identifies a token. How to verify it in under a minute.',
    h1: 'A token symbol is not an identity',
    intro: [
      'Token names and symbols are free-text fields chosen by whoever deploys the contract. There is no registry, no uniqueness constraint and no approval process. A token displaying "USDC" has told you nothing.',
      'The contract address is the only identifier that means anything, and checking it is fast once you know where to look.'
    ],
    sections: [
      ['How fakes get in front of you', [
        'Search results inside a wallet or a DEX interface that index every deployed token. Pools created specifically so the fake appears tradeable. Airdrops that put the token in your wallet so it shows in your balance list. Social posts with a contract address in the replies.',
        'The fake usually has a real-looking pool with some liquidity, so a small buy succeeds and reinforces the illusion.'
      ]],
      ['Verifying an address', [
        "Get the address from the project's own website or official documentation — not from a search result, not from a reply, not from a message. Then open it on the network explorer and check it is verified, has meaningful holder count and age, and matches the name.",
        'Cross-check on a second independent source. Two sources agreeing on the same address is a reasonable bar; one source is not.'
      ]],
      ['The same token on several chains', [
        'A legitimate project deployed on multiple networks has a different address on each. Copying the Ethereum address and using it on BNB Chain finds either nothing or something hostile that was deployed there deliberately.',
        'Always get the address for the specific chain you are trading on.'
      ]],
      ['What a curated list gives you', [
        'FBT Swap ships roughly ninety hand-verified tokens that work without any external list, and supports public token lists per chain plus importing any contract address. The import path exists because new legitimate tokens exist; it is also the path where verification is entirely on you.',
        'When you import by address, the interface is trusting your address. It cannot know whether you got it from the right place.'
      ]]
    ],
    howTo: [
      ['Start from the official source', "Open the project's own site or documentation and find the contract address for the specific network you are using."],
      ['Open the explorer', 'Paste the address into that network\'s explorer and confirm the contract is verified and the name matches.'],
      ['Check the shape of it', 'Look at holder count, age and transfer activity. A day-old contract with twelve holders claiming to be a major asset is not that asset.'],
      ['Cross-check', 'Confirm the same address from a second independent source before trading.'],
      ['Trade the address, not the symbol', 'Select or import by address so the interface cannot resolve a different token with the same name.']
    ],
    facts: [
      ['Uniqueness of symbols', 'None. Any string can be used by anyone'],
      ['Real identifier', 'The contract address, per network'],
      ['Verify with', "The project's own site plus the chain explorer"],
      ['Highest risk', 'Importing an address from a message or a search result']
    ],
    faqs: [
      { q: 'If a token appears in a swap interface, is it legitimate?', a: 'No. Appearing in a searchable list usually means it exists on-chain and sometimes that it has a pool. Neither is a safety assessment, and most interfaces say so.' },
      { q: 'Why did an unknown token appear in my wallet?', a: 'Anyone can send tokens to any address. Unsolicited tokens are usually advertising or bait leading to a malicious site. Do not interact with them; hide them.' },
      { q: 'Does a verified contract mean a safe token?', a: 'No. Verification means the published source matches the deployed bytecode. It says nothing about whether that source contains a mint function, a blacklist or a transfer fee.' }
    ]
  }),

  article({
    slug: 'honeypot-tokens',
    cluster: 'security',
    icon: 'alert',
    title: 'Honeypot Tokens: Easy to Buy, Impossible to Sell',
    description:
      'A honeypot contract permits purchases and blocks sales. How the trick is implemented, what it looks like on a chart, and how to test before buying.',
    h1: 'The token you can buy and never sell',
    intro: [
      'A honeypot is a token whose contract allows buying and prevents selling, usually for everyone except addresses the deployer controls. The chart looks perfect because there is no sell pressure — by construction.',
      'The victim buys, watches the price rise, tries to take profit, and discovers the sell transaction fails every time.'
    ],
    sections: [
      ['How the block is implemented', [
        'Common techniques include an allow-list that only the deployer is on, a sell tax set to one hundred percent, a transfer function that reverts when the destination is a pool, a blacklist applied after purchase, and a pausable transfer controlled by an owner key.',
        'Some are time-delayed: selling works for the first hours to build confidence, then a parameter is flipped.'
      ]],
      ['What it looks like from outside', [
        'A chart that only rises. Very few unique sellers relative to buyers. A tiny holder count with concentrated supply. Liquidity that is not locked, or is locked for a suspiciously short period. An unverified contract, or a verified one with owner-only functions.',
        'Aggressive promotion with a countdown is the usual accompaniment, because the model needs a flow of new buyers.'
      ]],
      ['Testing before committing', [
        'Buy a trivial amount and immediately attempt to sell a portion of it. If the sell reverts or quotes an absurd output, you have your answer for the cost of two gas fees.',
        'Honeypot scanners exist and catch the common patterns. They are useful and not conclusive — a contract can detect simulation, and a time-delayed honeypot passes every scan on day one.'
      ]],
      ['Reading the contract itself', [
        'On the explorer, look for owner-only functions that can change fees, pause transfers, or modify a blacklist. The presence of any of those means the deployer can make the token unsellable at will, whether or not they have yet.',
        'A renounced owner removes that specific risk and does not remove logic already written into the transfer function.'
      ]]
    ],
    facts: [
      ['Mechanism', 'Contract logic that permits buys and blocks or taxes sells'],
      ['Chart signature', 'Rises only; very few unique sellers'],
      ['Cheapest test', 'Buy a trivial amount, then immediately try to sell some'],
      ['Scanner limits', 'Miss time-delayed and simulation-aware implementations']
    ],
    faqs: [
      { q: 'Can a honeypot be undone?', a: 'Only by whoever controls the contract, and they built it this way deliberately. There is no mechanism available to you, and no interface can force a transfer the token contract refuses.' },
      { q: 'Why did my sell fail with a slippage error?', a: 'A one hundred percent sell tax produces an output below any tolerance, so the error surfaces as slippage. Raising tolerance will not help; the token is taking everything.' },
      { q: 'Is FBT Swap able to detect honeypots?', a: 'The interface routes through public aggregators and shows the quote and price impact. It cannot audit arbitrary token contracts, which is why the test-sell habit matters for any token you imported by address.' }
    ]
  }),

  article({
    slug: 'phishing-sites-crypto',
    cluster: 'security',
    icon: 'privacy',
    title: 'Phishing Clones: Identical Interface, Different Domain',
    description:
      'Crypto phishing copies the real site exactly and changes only the address. Where the traffic comes from, and the one habit that defeats all of it.',
    h1: 'The clone is perfect. The domain is not.',
    intro: [
      'A phishing site for a crypto interface is usually a byte-for-byte copy of the real front end with the transaction logic replaced. Nothing on the page is wrong, because the page is the real page.',
      'The only difference is the address bar, which is why every effective defence is about how you arrive rather than what you see.'
    ],
    sections: [
      ['How people arrive at the clone', [
        'Paid advertisements above genuine search results. Replies and quote-posts under official announcements. Compromised community servers posting a "new domain". Direct messages from accounts that copied a real profile. QR codes in images.',
        'Notice what these share: in every case the link came to you. Almost nobody reaches a phishing site by typing an address they already knew.'
      ]],
      ['The lookalike domain tricks', [
        'Character substitution that is hard to see at a glance, extra hyphens, a different top-level domain, a subdomain arrangement that puts the real name where the path should be, and internationalised characters that render identically to Latin ones.',
        'Reading a domain carefully once is far more reliable than trying to spot these under time pressure.'
      ]],
      ['The habit that works', [
        'Reach the site from your own bookmark, created from an address you verified once. Never from a message, an advertisement or a search result. If you must search, verify the domain before connecting anything.',
        'FBT Swap has exactly one official domain: fbtswap.ir. Any other address using the name is not us, including addresses that look like a regional or backup version.'
      ]],
      ['If you already connected', [
        'Connecting alone grants nothing. Check whether you approved any transaction or signed any message; if you did, assume the permission is live. Move assets to a fresh wallet, then revoke allowances on the old address.',
        'Do not use a "revoke" link provided by the same source. Navigate to the explorer or a revocation tool by typing the address yourself.'
      ]]
    ],
    facts: [
      ['What is cloned', 'The entire front end — the page is genuinely identical'],
      ['What differs', 'The domain, and the transaction the page builds'],
      ['Arrival channel', 'A link sent to you, in almost every case'],
      ['Our only domain', 'fbtswap.ir']
    ],
    faqs: [
      { q: 'Does HTTPS mean a site is genuine?', a: 'No. A padlock means the connection is encrypted, not that the operator is honest. Phishing sites have valid certificates as a matter of course.' },
      { q: 'Is a top search result safe?', a: 'Not necessarily, especially if it is an advertisement. Paid placement above organic results has been used repeatedly to serve crypto phishing, and the ad label is easy to miss on a phone.' },
      { q: 'What if the clone is on a domain that looks official?', a: 'Compare it character by character against the address you verified. If it differs in any way at all, it is a different site, regardless of how plausible the difference seems.' }
    ]
  }),

  article({
    slug: 'fake-support-scams',
    cluster: 'security',
    icon: 'chat',
    title: 'Fake Support: The Scam That Arrives After You Ask for Help',
    description:
      'Post a problem publicly and impersonators reply within minutes. How they operate, what they ask for, and why no real team ever messages first.',
    h1: 'Nobody legitimate messages you first',
    intro: [
      'Mention a crypto problem in any public channel and you will receive direct messages within minutes. They will be polite, branded, and fast — faster than any real support team, because responding instantly is the entire business model.',
      'The script is consistent enough to recognise before reading the details.'
    ],
    sections: [
      ['The standard script', [
        'A branded profile offers help, moves you to a private channel, and asks you to "validate", "synchronise" or "restore" your wallet on a form. The form requests the recovery phrase. Some skip it and request a remote-desktop session instead.',
        'A variant asks for an upfront fee to "unlock" or "recover" funds. The fee is the product; nothing is ever recovered.'
      ]],
      ['Why the branding is convincing', [
        'Logos, banners and handles are copied from the real accounts. Some impersonators maintain profiles for months and post normal content to build history. Group names are duplicated so a search returns the fake alongside the real one.',
        'Judging authenticity by appearance does not work. Judging by behaviour does.',
        "Urgency is the common thread. Every version of this introduces a deadline, whether it is funds at risk, a window closing or an account about to be locked, because deliberation is the thing that defeats it. A real problem with your wallet does not expire in ten minutes."
      ]],
      ['The behavioural tells', [
        'They contacted you first. They moved the conversation to private immediately. They created urgency. They asked for a phrase, a key, a password, remote access, or an upfront payment. Any one of these is sufficient.',
        'A real team answers in public, does not need your phrase, and has no mechanism that requires your key.'
      ]],
      ['What FBT Swap will never do', [
        'We will never message you first. We will never ask for a recovery phrase, a private key or a wallet password. We cannot reverse a transaction, unfreeze funds or recover a lost phrase — and we say so rather than implying otherwise.',
        'The only contact address is fbtswap@gmail.com and the only domain is fbtswap.ir. Anyone else using the name is impersonating the project.'
      ]]
    ],
    facts: [
      ['Trigger', 'Mentioning a problem in any public crypto channel'],
      ['Ask', 'Recovery phrase, private key, remote access, or an upfront fee'],
      ['Tell', 'They contacted you; a real team does not'],
      ['Our contact', 'fbtswap@gmail.com — outbound contact never happens']
    ],
    faqs: [
      { q: 'How can I verify a support account is real?', a: 'Only by reaching it from the project\'s official site yourself. Verification badges, follower counts and conversation history can all be manufactured or bought.' },
      { q: 'They only asked for my public address. Is that safe?', a: 'Sharing a public address is harmless in itself — it is already public. It does mark you as a target, and the request is usually the first step toward a more expensive one.' },
      { q: 'Can anyone recover funds sent to a scammer?', a: 'No. On-chain transfers are final. If a stolen amount reaches a centralised exchange, a report may occasionally lead to a freeze there, but that is outside anyone\'s control and is not recovery.' }
    ]
  }),

  article({
    slug: 'rug-pull-warning-signs',
    cluster: 'security',
    icon: 'alert',
    title: 'Rug Pulls: The Warning Signs That Were Visible Beforehand',
    description:
      'Liquidity removal, mint functions, concentrated supply and anonymous teams with upgrade keys. The checks that are possible before you buy.',
    h1: 'What a rug pull looks like before it happens',
    intro: [
      'A rug pull is the deliberate removal of value from a project by the people running it: pulling liquidity, minting and dumping supply, or draining a treasury. The losses are large because the structure made them possible from day one.',
      'Most of the warning signs are visible on-chain before anything happens. They are not predictions; they are facts about who can do what.'
    ],
    sections: [
      ['Liquidity that can be withdrawn', [
        'If the deployer holds the liquidity provider tokens, they can withdraw the pool at any moment and the token becomes untradeable instantly. Locked liquidity moves this risk to the lock duration and to who controls the locker.',
        'Check whether liquidity is locked, for how long, and by what mechanism. "Locked" with an unlock date next week is not a meaningful commitment.'
      ]],
      ['Contract powers that remain', [
        'An unrestricted mint function means supply can be created and sold into the pool. A pausable transfer, an owner-modifiable fee or a blacklist means your ability to sell is permission-based.',
        'An upgradeable proxy means the code you reviewed can be replaced entirely. Renouncing ownership removes some of this; it does not remove logic already in the transfer path.'
      ]],
      ['Supply distribution', [
        'A handful of addresses holding most of the supply means the price is whatever those holders decide. Explorers show the top holders; a token where the top ten hold ninety percent has a concentrated exit risk regardless of intentions.',
        'Check also whether apparent distribution is real or just many wallets controlled by one entity, which funding patterns often reveal.'
      ]],
      ['Team and treasury', [
        'Anonymity is not automatically disqualifying, but anonymity combined with unilateral control over liquidity, supply and upgrades leaves nothing but trust. A multisig with a timelock on privileged functions is a meaningfully different structure.',
        'FBT Swap takes no position on which tokens are worth owning and does not list or endorse them. It routes trades on public markets and shows the quote, the route and the fee — the diligence on the token itself is yours.'
      ]]
    ],
    facts: [
      ['Liquidity', 'Who holds the LP tokens, and for how long are they locked'],
      ['Contract', 'Mint, pause, blacklist, fee change, upgradeable proxy'],
      ['Supply', 'Top-holder concentration and funding patterns between wallets'],
      ['Governance', 'A timelocked multisig is structurally different from one key']
    ],
    faqs: [
      { q: 'Does an audit prevent a rug pull?', a: 'No. An audit assesses code quality against a scope. It does not prevent a team using powers the code legitimately contains, and many rugged tokens were audited.' },
      { q: 'Is renounced ownership a guarantee?', a: 'It removes the owner\'s ability to call owner-only functions. It does not affect fees or restrictions already hard-coded, and it does not apply if the contract sits behind an upgradeable proxy someone else controls.' },
      { q: 'Can I get money back after a rug pull?', a: 'Almost never. The transactions are valid and on-chain, the proceeds are usually dispersed within minutes, and there is no counterparty obliged to return anything.' }
    ]
  }),

  article({
    slug: 'verify-smart-contract-before-signing',
    cluster: 'security',
    icon: 'code',
    title: 'How to Check a Contract Before You Sign Anything',
    description:
      'Verification status, owner functions, proxy patterns, holder distribution and simulation. A practical sequence that takes a few minutes.',
    h1: 'A practical contract check, in a few minutes',
    intro: [
      'You do not need to read Solidity to assess most of the risk in a contract. The questions that matter are structural and answerable from a block explorer.',
      'This is the sequence, ordered so the cheapest disqualifying answers come first.'
    ],
    sections: [
      ['Is the source published and does it match?', [
        'A verified contract on the explorer means the published source compiles to the deployed bytecode. Unverified means you are trusting bytecode nobody has shown you, which for anything holding value is reason enough to stop.',
        'Verified is a floor, not a conclusion. It tells you what the code is; it does not tell you the code is benign.'
      ]],
      ['Who can change what?', [
        'Scan the function list for owner-restricted entries: mint, pause, setFee, blacklist, setRouter, upgradeTo. Each one is a power someone holds right now. Check who the owner is — an individual key, a multisig, a timelock, or nothing.',
        'If the contract is behind a proxy, the implementation can be swapped. Find out who can perform that swap and whether a delay applies.'
      ]],
      ['What does the on-chain history say?', [
        'Deployment age, number of holders, transaction count and whether activity looks organic. A contract deployed yesterday with concentrated holdings and heavy promotion is a specific pattern, not a coincidence.',
        'For a token, look at the liquidity pool: size, lock status and whether the deployer still holds the LP tokens.',
        "Age is weak evidence on its own and it is cheap to check. A contract that has held significant value for a year without incident has survived scrutiny a contract deployed this morning has not. That is not a guarantee of anything; it is a different starting assumption."
      ]],
      ['Simulate before committing', [
        'Many wallets preview the balance changes a transaction will produce. Read that preview — it converts an opaque call into "you will lose X and gain Y", which is the only summary that matters.',
        'For a token you intend to hold, buy a trivial amount and test a sale first. Two gas fees is cheap insurance against a one-way contract.'
      ]]
    ],
    howTo: [
      ['Check verification', 'Open the address on the network explorer and confirm the source is published and matches the deployed bytecode.'],
      ['List the privileged functions', 'Look for mint, pause, fee, blacklist and upgrade functions, and identify who can call them.'],
      ['Identify the owner', 'A single key, a multisig or a timelock are three very different levels of risk. Nothing renounced is a fourth.'],
      ['Read the on-chain history', 'Age, holders, concentration, liquidity size and whether the LP tokens are locked.'],
      ['Simulate and test', 'Use your wallet\'s transaction preview, and for tokens test a small sell before buying at size.']
    ],
    facts: [
      ['Minimum bar', 'Published, verified source on the explorer'],
      ['Highest-value check', 'Which functions are owner-only and who the owner is'],
      ['Proxy', 'Means the code can be replaced — find out by whom and how fast'],
      ['Cheapest insurance', 'A small test transaction before a real one']
    ],
    faqs: [
      { q: 'Do I need to understand the code?', a: 'Not for most of this. Verification status, the list of privileged functions, the owner type and the holder distribution answer most of the risk question and are all readable from the explorer interface.' },
      { q: 'Is an audited contract safe to sign?', a: 'An audit reduces the chance of unintentional bugs within its scope. It does not cover deliberate powers, post-audit upgrades, or the behaviour of contracts this one calls.' },
      { q: 'What does FBT Swap check for me?', a: 'It routes through established public aggregators and ships a hand-verified token set, and it shows the route and price impact. It does not and cannot audit arbitrary contracts you import by address.' }
    ]
  }),

  article({
    slug: 'sim-swap-and-2fa-crypto',
    cluster: 'security',
    icon: 'key',
    title: 'SIM Swaps and Why SMS Is the Weakest Second Factor',
    description:
      'A phone number can be transferred to an attacker with social engineering. What that breaks, what it does not, and which factors to use instead.',
    h1: 'Your phone number is not an authentication factor',
    intro: [
      'A SIM swap is a carrier-level account takeover: the attacker persuades or bribes a provider to move your number to their device. Every code sent to that number then reaches them.',
      'It matters for crypto because so many accounts adjacent to crypto — exchanges, email, cloud storage — still accept SMS as a recovery path.'
    ],
    sections: [
      ['What a SIM swap actually reaches', [
        'Anything where the phone number can reset a password or satisfy a second factor. That typically means your email, which then unlocks almost everything else, including centralised exchange accounts.',
        'It does not reach a self-custodied wallet. A private key is not protected by a phone number, which is one of the genuine advantages of self-custody.'
      ]],
      ['Why SMS keeps being accepted', [
        'It has near-universal reach and no app requirement, so it remains the default recovery mechanism at many providers. The weakness is not the message — it is that the number can be reassigned by a human decision at a call centre.',
        'Removing SMS where possible, and adding a carrier-level port-out PIN where it is not, closes most of the gap.'
      ]],
      ['Factors that are meaningfully stronger', [
        'A hardware security key is the strongest widely available option and resists phishing by design, because it verifies the domain. An authenticator application is a large improvement over SMS. Both should have recovery codes stored offline.',
        'Email-based recovery is only as strong as the email account, so that account deserves the strongest factor you have.'
      ]],
      ['Reducing the blast radius', [
        'Use a dedicated email address for financial accounts that is not published anywhere. Remove SMS recovery wherever an alternative exists. Keep self-custodied funds in wallets whose keys have no relationship to any online account.',
        'FBT Swap requires no account, no email and no phone number for the on-chain swap interface, so there is no FBT login for a SIM swap to take over.'
      ]]
    ],
    facts: [
      ['What it is', 'Reassignment of your phone number to an attacker'],
      ['Reaches', 'SMS codes and any account recoverable by phone number'],
      ['Does not reach', 'A self-custodied private key'],
      ['Best factor', 'A hardware security key; an authenticator app as a minimum']
    ],
    faqs: [
      { q: 'Can a SIM swap steal my wallet?', a: 'Not directly. A private key has no connection to a phone number. The risk is indirect: your email and exchange accounts, and anything where you stored key material online.' },
      { q: 'Is an authenticator app enough?', a: 'It is far better than SMS and still phishable, because you can be tricked into entering a code on a fake site. A hardware key removes that because it checks the domain itself.' },
      { q: 'Does FBT Swap need my phone number?', a: 'No. There is no account, no email and no phone number for the on-chain swap interface. Notifications are optional and device-based.' }
    ]
  }),

  article({
    slug: 'public-wifi-and-crypto-safety',
    cluster: 'security',
    icon: 'globe',
    title: 'Public Wi-Fi and Crypto: The Real Risk Is Not Interception',
    description:
      'HTTPS protects the connection. The genuine risks on a shared network are DNS manipulation, captive portals, shoulder surfing and device compromise.',
    h1: 'What public Wi-Fi actually threatens',
    intro: [
      'The common advice — never use crypto on public Wi-Fi because someone can read your traffic — describes a threat that modern transport encryption largely handles. The real risks are different and less discussed.',
      'They are worth knowing because they change what you should do, which is not simply "avoid cafés".'
    ],
    sections: [
      ['Encryption already covers interception', [
        'HTTPS encrypts content between your device and the site, so another device on the same network sees destinations and timing, not page contents or what you typed. Your private key never travels anywhere in any case.',
        'This is why passive sniffing is not the primary concern it was a decade ago.'
      ]],
      ['DNS and captive-portal manipulation', [
        'A hostile network can answer DNS queries with its own addresses, sending you to a clone of a site you typed correctly. Captive portals normalise clicking through certificate warnings, which trains exactly the wrong instinct.',
        'A browser that enforces encrypted DNS, and a refusal to dismiss certificate warnings, both help. A reputable VPN moves the trust from the local network to the VPN provider, which is an improvement when the local network is unknown.',
        "A VPN moves the trust rather than removing it. The network operator can no longer observe or redirect your traffic, and the VPN provider now can. That is usually the better trade on an unknown network, and a worse one if the provider is free and unaccountable."
      ]],
      ['The physical risks are underrated', [
        'Someone can see your screen, your approval prompt and your device passcode. A phone left unlocked on a table is a complete compromise with no technology involved at all.',
        'Shoulder surfing is far more likely in a busy public place than a network attack.'
      ]],
      ['A workable rule', [
        'Routine checking of balances on public Wi-Fi is fine. Signing meaningful transactions is better done on a network and in a setting you control, mostly for the physical reasons rather than the network ones.',
        'Never enter a recovery phrase in public under any circumstances, on any network.'
      ]]
    ],
    facts: [
      ['Handled by HTTPS', 'Content interception on the local network'],
      ['Not handled', 'DNS manipulation and hostile captive portals'],
      ['Most likely risk', 'Someone reading your screen or taking an unlocked device'],
      ['Absolute rule', 'Never enter a recovery phrase in a public place']
    ],
    faqs: [
      { q: 'Do I need a VPN for crypto?', a: 'It helps on untrusted networks by moving trust from the local operator to the VPN provider. It is not a substitute for verifying domains and reading approval prompts, which is where losses actually occur.' },
      { q: 'Can someone steal my key over Wi-Fi?', a: 'Not from the network. The key never leaves your wallet during normal use. Theft requires malware on the device or persuading you to reveal or approve something.' },
      { q: 'Is mobile data safer than public Wi-Fi?', a: 'Generally yes, because you are not sharing a network with unknown parties and DNS comes from your carrier. The physical risks of being in a public place are unchanged.' }
    ]
  }),

  article({
    slug: 'airdrop-scams',
    cluster: 'security',
    icon: 'spark',
    title: 'Airdrop Scams: Free Tokens as an Attack Vector',
    description:
      'Fake claim pages, tokens sent to bait you, and eligibility checkers that request approvals. How legitimate airdrops differ from the imitations.',
    h1: 'When a free token is the bait',
    intro: [
      'Airdrops are real and people genuinely receive meaningful amounts from them. That legitimacy is exactly what makes the imitation effective — a claim page is a normal thing to visit.',
      'The imitations share a structure that is easy to recognise once named.'
    ],
    sections: [
      ['The claim-page pattern', [
        'A page announces an airdrop, asks you to connect, and then requests an approval or a permit signature to "verify eligibility" or "cover the claim". No legitimate claim requires permission over an unrelated token you already hold.',
        'Some request a small payment to "activate" the claim. That payment is the entire scam, and nothing arrives afterwards.'
      ]],
      ['Tokens sent to you as bait', [
        'An unknown token appears in your wallet showing a large notional value. Selling it requires visiting a site named in the token metadata, which is a drainer. The token exists purely to deliver you to that page.',
        'Receiving it is harmless. Interacting with it is the attack.'
      ]],
      ['What genuine airdrops look like', [
        'Announced through the project\'s own established channels, with a claim on its own verified domain. Eligibility is already determined by a published snapshot, so no checker needs permission over your tokens. Claiming costs gas and nothing else.',
        'If you have to find out about it from a direct message, it is almost certainly not real.'
      ]],
      ['Checking before you claim', [
        'Navigate to the project\'s site yourself rather than following a link. Confirm the claim contract address against the official announcement. Read the wallet prompt — a claim transaction should not include an approval for a token you already hold.',
        'If anything does not line up, missing the airdrop is cheaper than the alternative.',
        "FBT Swap never distributes tokens through direct messages and never asks you to connect a wallet to claim anything. It is a non-custodial interface with no token to give away, and it does not contact users first under any circumstances."
      ]]
    ],
    facts: [
      ['Fake claim', 'Requests an approval or permit for a token you already hold'],
      ['Bait token', 'Arrives unsolicited and points you to a malicious site'],
      ['Real claim', 'Costs gas only; eligibility comes from a published snapshot'],
      ['Arrival', 'If you learned about it from a DM, treat it as fake']
    ],
    faqs: [
      { q: 'Is it dangerous to hold an unknown airdropped token?', a: 'Holding it is harmless; a token cannot act on its own. The danger begins if you approve it, swap it on a site it names, or visit a page from its metadata.' },
      { q: 'Should a real airdrop ever cost money?', a: 'It costs gas to claim, paid to the network. Any request for a payment to the project to unlock a claim is a scam pattern with no legitimate counterpart.' },
      { q: 'How do I check if I am eligible safely?', a: 'Use the official site reached by your own navigation. Eligibility checks read public addresses and never need an approval or a signature granting spending power.' }
    ]
  }),

  article({
    slug: 'crypto-security-checklist',
    cluster: 'security',
    icon: 'check',
    title: 'A Crypto Security Checklist You Can Finish Today',
    description:
      'Twelve concrete actions ordered by value: wallet separation, approval review, backup testing, bookmark discipline and device hygiene.',
    h1: 'Twelve things worth doing, in order',
    intro: [
      'Security advice usually arrives as principles. Principles are hard to act on, so this is a list of specific actions ordered by how much risk each one removes per minute spent.',
      'Most people can complete the first six in under an hour, and that hour removes the large majority of realistic loss scenarios.'
    ],
    sections: [
      ['The first hour', [
        'Create a separate spending wallet with its own recovery phrase and move anything not actively traded to a storage wallet. Review and revoke token approvals on every chain you have used. Verify your recovery phrase backup exists on durable media and is not a photograph.',
        'Then create a bookmark for every crypto site you use, reached from an address you verified, and use only those bookmarks from now on.'
      ]],
      ['The second hour', [
        'Move email and exchange accounts off SMS second factors onto an authenticator app or a hardware key. Add a carrier port-out PIN. Audit browser extensions and remove anything unused. Update your operating system, browser and wallet applications.',
        'Test a wallet restore into a clean installation and confirm the first address matches, then remove that installation.'
      ]],
      ['Ongoing habits', [
        'Read every wallet prompt: token, spender, amount, network. Send a small test transfer before any first transfer to a new destination. Never copy an address from transaction history. Never enter a recovery phrase anywhere except a wallet you are restoring.',
        'Assume anyone who contacts you first is not who they claim to be, including anyone using the FBT Swap name.'
      ]],
      ['What this does not cover', [
        'None of this protects against a protocol exploit, a bridge hack or a token whose team decides to leave. Those are risks of what you own, not of how you hold it, and they require diligence on each specific asset.',
        'FBT Swap is non-custodial: it holds nothing, so it cannot freeze, reverse or recover anything. That is the trade this checklist exists to make survivable.'
      ]]
    ],
    howTo: [
      ['Split your wallets', 'A storage wallet and a spending wallet, with separate recovery phrases. Fund the spending wallet from storage, never the reverse.'],
      ['Revoke old approvals', 'Work through every chain you have used and set unused allowances to zero.'],
      ['Fix your backup', 'Durable physical media, two locations, no photographs or cloud notes.'],
      ['Bookmark everything', 'Verify each domain once and reach it only from your own bookmark afterwards.'],
      ['Upgrade your second factors', 'Replace SMS with an authenticator app or hardware key on email and exchange accounts.'],
      ['Test a restore', 'Import your phrase into a clean wallet install, confirm the address, then remove it.'],
      ['Keep the habits', 'Read every prompt, test new destinations with a small amount, and never trust an inbound message.']
    ],
    facts: [
      ['Highest value', 'Wallet separation and approval revocation'],
      ['Most neglected', 'Testing that the backup actually restores'],
      ['Free and permanent', 'Bookmark discipline instead of search or links'],
      ['Out of scope', 'Protocol, bridge and token-team risk — diligence per asset']
    ],
    faqs: [
      { q: 'Where should I start if I only have ten minutes?', a: 'Move anything you are not actively trading into a separate wallet with its own phrase. It bounds the damage of every other mistake on this list.' },
      { q: 'How often should I repeat the review?', a: 'Quarterly covers most people, plus after any period of heavy experimentation and before a large balance arrives in a wallet.' },
      { q: 'Does using a non-custodial app make me safer?', a: 'It removes counterparty risk and replaces it with key-management risk. Safer depends entirely on whether you do the items above; this list exists because that is not automatic.' }
    ]
  })
];
