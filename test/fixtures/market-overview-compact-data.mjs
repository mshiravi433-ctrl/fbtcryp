// Deterministic visual-QA data. Never imported by the production route.
const assets = [
  ['bitcoin','BTC','Bitcoin',92450,1.83e12,4.2e10,2.41],
  ['ethereum','ETH','Ethereum',3420,4.12e11,2.1e10,-1.82],
  ['tether','USDT','Tether',1,1.42e11,6.4e10,0.01],
  ['solana','SOL','Solana',174.32,8.2e10,7.5e9,6.42],
  ['binancecoin','BNB','BNB',608.71,8.9e10,2.3e9,1.25],
  ['ripple','XRP','XRP',1.42,8.1e10,3.1e9,-2.84],
  ['usd-coin','USDC','USDC',1,5.6e10,9.2e9,0],
  ['cardano','ADA','Cardano',0.4281,1.5e10,6.2e8,4.81],
  ['dogecoin','DOGE','Dogecoin',0.1829,2.6e10,1.8e9,-4.22],
  ['chainlink','LINK','Chainlink',15.82,9.8e9,5.4e8,3.14],
  ['avalanche-2','AVAX','Avalanche',28.73,1.2e10,4.9e8,-0.62],
  ['shiba-inu','SHIB','Shiba Inu',0.0000182,1.1e10,3.8e8,8.22],
  ['polkadot','DOT','Polkadot',4.12,6.2e9,2.1e8,1.92],
  ['uniswap','UNI','Uniswap',8.42,5.1e9,1.9e8,-3.11],
  ['aave','AAVE','Aave',285,4.3e9,5.4e8,6.2],
  ['litecoin','LTC','Litecoin',92.4,6.9e9,3.2e8,0.84],
  ['sui','SUI','Sui',2.14,6.1e9,4.1e8,5.41],
  ['aptos','APT','Aptos',5.12,3.2e9,1.8e8,-1.42],
  ['near','NEAR','NEAR Protocol',3.84,4.1e9,2.2e8,2.72],
  ['arbitrum','ARB','Arbitrum',1.12,4.6e9,6.9e8,-5.4],
  ['optimism','OP','Optimism',1.41,2.1e9,1.7e8,3.62],
  ['render-token','RNDR','Render',4.82,2.4e9,1.6e8,7.14],
  ['injective-protocol','INJ','Injective',14.2,1.4e9,1.2e8,-2.18],
  ['celestia','TIA','Celestia',3.12,1.2e9,1.1e8,4.42]
];
export const overviewCompactCoins = assets.map(([id,symbol,name,price,mcap,volume,change24h], i) => ({
  id, symbol, name, price, mcap, volume, change24h,
  rank: i + 1,
  change1h: Number((change24h * 0.18).toFixed(2)),
  change7d: Number((change24h * 2.1).toFixed(2)),
  mcapChange24h: mcap * change24h / 100,
  image: `https://fixture.invalid/${id}.png`
}));
export const overviewCompactGlobal = { mcap: 3.152e12, volume: 1.42e11, btcDominance: 56.4, ethDominance: 13.8 };
export const overviewCompactDefi = {
  totalTvlUsd: 108.4e9, tvlChange24hPct: 2.35, tvlChange30dPct: 8.1, tvlChange90dPct: 19.4,
  tvlHistory90d: Array.from({length:45},(_,i)=>90e9+i*4.2e8+Math.sin(i*.7)*1.2e9),
  ethSharePct: 56.2,
  topChains: [
    { name:'Ethereum', symbol:'ETH', tvlUsd:60.9e9, sharePct:56.2, fbtSupported:true, swapHref:'/swap?chain=1&from=ETH' },
    { name:'Solana', symbol:'SOL', tvlUsd:9.8e9, sharePct:9.0, fbtSupported:true, swapHref:'/swap?chain=solana' },
    { name:'BSC', symbol:'BNB', tvlUsd:6.2e9, sharePct:5.7, fbtSupported:true, swapHref:'/swap?chain=56&from=BNB' },
    { name:'Base', symbol:'ETH', tvlUsd:4.1e9, sharePct:3.8, fbtSupported:true, swapHref:'/swap?chain=8453&from=ETH' },
    { name:'Arbitrum', symbol:'ARB', tvlUsd:3.2e9, sharePct:2.9, fbtSupported:true, swapHref:'/swap?chain=42161&from=ETH' },
    { name:'Avalanche', symbol:'AVAX', tvlUsd:1.8e9, sharePct:1.7, fbtSupported:true, swapHref:'/swap?chain=43114&from=AVAX' },
    { name:'Sui', symbol:'SUI', tvlUsd:1.4e9, sharePct:1.3 },
    { name:'Polygon', symbol:'POL', tvlUsd:1.2e9, sharePct:1.1, fbtSupported:true, swapHref:'/swap?chain=137&from=POL' }
  ],
  categories: [
    { id:'liquid_staking', tvlUsd:38e9, sharePct:35.1, protocolCount:42, leaderName:'Lido', fbtRoute:'/farm' },
    { id:'lending', tvlUsd:31e9, sharePct:28.6, protocolCount:95, leaderName:'Aave', fbtRoute:'/loan' },
    { id:'dexs', tvlUsd:18e9, sharePct:16.6, protocolCount:210, leaderName:'Uniswap', fbtRoute:'/swap' },
    { id:'bridge', tvlUsd:8e9, sharePct:7.4, protocolCount:38, leaderName:'THORChain', fbtRoute:'/bridge' },
    { id:'restaking', tvlUsd:6e9, sharePct:5.5, protocolCount:18, leaderName:'EigenLayer', fbtRoute:'/farm' }
  ],
  topProtocols: [
    { name:'Lido', slug:'lido', symbol:'LDO', category:'Liquid Staking', tvlUsd:26e9, change1d:1.8, chainsCount:5, fbtIntegrated:true, fbtRoute:'/farm' },
    { name:'Aave V3', slug:'aave-v3', symbol:'AAVE', category:'Lending', tvlUsd:21e9, change1d:2.1, chainsCount:12, fbtIntegrated:true, fbtRoute:'/loan' },
    { name:'EigenLayer', slug:'eigenlayer', symbol:'EIGEN', category:'Restaking', tvlUsd:12e9, change1d:-0.4, chainsCount:1, fbtIntegrated:true, fbtRoute:'/farm' },
    { name:'Uniswap V3', slug:'uniswap-v3', symbol:'UNI', category:'DEXs', tvlUsd:5.4e9, change1d:-0.6, chainsCount:24, fbtIntegrated:true, fbtRoute:'/swap' },
    { name:'Curve DEX', slug:'curve-dex', symbol:'CRV', category:'DEXs', tvlUsd:4.2e9, change1d:1.2, chainsCount:18, fbtIntegrated:true, fbtRoute:'/swap' },
    { name:'Kamino', slug:'kamino', symbol:'KMNO', category:'Lending', tvlUsd:3.1e9, change1d:3.4, chainsCount:1, fbtIntegrated:true, fbtRoute:'/loan' }
  ],
  dexVolume24hUsd:14.5e9, dexChange24hPct:5.2, fees24hUsd:82e6, revenue24hUsd:26e6,
  stablecoinTotalUsd:304e9, stablecoinNet24hUsd:420e6,
  topStablecoins: [
    { symbol:'USDT', name:'Tether', circulatingUsd:185e9, sharePct:60.8, delta24hUsd:310e6 },
    { symbol:'USDC', name:'USDC', circulatingUsd:56e9, sharePct:18.4, delta24hUsd:120e6 },
    { symbol:'DAI', name:'Dai', circulatingUsd:5.2e9, sharePct:1.7, delta24hUsd:-18e6 },
    { symbol:'FDUSD', name:'First Digital USD', circulatingUsd:4.1e9, sharePct:1.3, delta24hUsd:22e6 },
    { symbol:'PYUSD', name:'PayPal USD', circulatingUsd:3.8e9, sharePct:1.2, delta24hUsd:14e6 }
  ],
  chainInflows:[{chain:'Ethereum',delta24hUsd:280e6},{chain:'Solana',delta24hUsd:95e6}],
  chainOutflows:[{chain:'Tron',delta24hUsd:-95e6},{chain:'BSC',delta24hUsd:-22e6}]
};
