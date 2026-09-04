/**
 * FBT INTENT OS — Intent Agent (Top-level Understanding & Smart Clarification)
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Multi-Agent Reasoning
 *
 * Capabilities:
 *   - Extract structured intent, capital ($), horizon (duration), objective, risk preference
 *   - Identify missing essential parameters without throwing errors
 *   - Formulate minimal smart clarifying questions (max 1-2 questions with chips)
 *   - Route to specialized agents
 */

import { understandIntent } from '../intentUnderstanding.js';

export const INTENT_AGENT_SCHEMA = 'fbt.intent-agent.v3';

function toLatinDigits(str) {
  return String(str || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

const WORD_DIGITS = Object.freeze({
  'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5,
  'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
});

export function createIntentAgent() {
  return {
    id: 'intent-agent',
    schema: INTENT_AGENT_SCHEMA,
    
    async perceive({ message, context = {} } = {}) {
      return {
        message: String(message || '').trim(),
        context,
        timestamp: Date.now(),
        currentPage: context.currentPage || '/',
        hasWallet: Boolean(context.wallet?.connected)
      };
    },
    
    async understand({ message, context = {} } = {}) {
      const intent = understandIntent(message, context);
      
      // Extract Financial Intent Parameters (Spec §8)
      const rawText = String(message || '').toLowerCase();
      const text = toLatinDigits(rawText);
      
      // Capital extraction
      let capital = (intent.entities?.amount != null || intent.entities?.amountUsd != null) ? Number(intent.entities.amount || intent.entities.amountUsd) : null;
      if (!capital) {
        const dollarMatch = text.match(/(?:\$|usd|دلار)\s*([\d,]+(?:\.\d+)?)/i) || text.match(/([\d,]+(?:\.\d+)?)\s*(?:\$|usd|دلار)/i);
        if (dollarMatch) {
          capital = Number(dollarMatch[1].replace(/,/g, ''));
        }
      }
      if (!capital) {
        // Spelled out words: e.g. پنج هزار دلار
        for (const [word, val] of Object.entries(WORD_DIGITS)) {
          if (text.includes(`${word} هزار`)) {
            capital = val * 1000;
            break;
          }
          if (text.includes(`${word} میلیون`)) {
            capital = val * 1000000;
            break;
          }
        }
      }

      // Time Horizon extraction
      let timeHorizon = null;
      if (/(\d+)\s*(?:ماه|month|months|mo)/i.test(text)) {
        const m = text.match(/(\d+)\s*(?:ماه|month|months|mo)/i);
        timeHorizon = `${m[1]} Months`;
      } else if (/(\d+)\s*(?:هفته|week|weeks|w)/i.test(text)) {
        const m = text.match(/(\d+)\s*(?:هفته|week|weeks|w)/i);
        timeHorizon = `${m[1]} Weeks`;
      } else if (/(\d+)\s*(?:روز|day|days|d)/i.test(text)) {
        const m = text.match(/(\d+)\s*(?:روز|day|days|d)/i);
        timeHorizon = `${m[1]} Days`;
      } else if (/(\d+)\s*(?:سال|year|years|y)/i.test(text)) {
        const m = text.match(/(\d+)\s*(?:سال|year|years|y)/i);
        timeHorizon = `${m[1]} Years`;
      } else {
        for (const [word, val] of Object.entries(WORD_DIGITS)) {
          if (text.includes(`${word} ماه`) || text.includes(`${word} month`)) {
            timeHorizon = `${val} Months`;
            break;
          }
          if (text.includes(`${word} هفته`) || text.includes(`${word} week`)) {
            timeHorizon = `${val} Weeks`;
            break;
          }
          if (text.includes(`${word} سال`) || text.includes(`${word} year`)) {
            timeHorizon = `${val} Years`;
            break;
          }
        }
      }

      if (!timeHorizon) {
        if (/کوتاه‌مدت|short[\s-]?term/i.test(text)) {
          timeHorizon = 'Short-term (1-4 weeks)';
        } else if (/بلندمدت|long[\s-]?term/i.test(text)) {
          timeHorizon = 'Long-term (6-12 months)';
        }
      }

      // Objective extraction
      let objective = 'BALANCED_GROWTH';
      if (/سود|بیشترین|max|maximize|return|profit/i.test(text)) {
        objective = 'RETURN_MAXIMIZATION';
      } else if (/حفظ|امن|safe|preserve|کم‌ریسک|protect/i.test(text)) {
        objective = 'CAPITAL_PRESERVATION';
      } else if (/yield|passive|درآمد|سود ماهانه|income|farm|stake/i.test(text)) {
        objective = 'PASSIVE_YIELD';
      } else if (/speculat|نوسان‌گیری|اهرم|futures|trade/i.test(text)) {
        objective = 'SPECULATION';
      }

      // Risk Preference extraction
      let riskPreference = null;
      if (/کم‌ریسک|کم ریسک|low[\s-]?risk|conservative|محتاط/i.test(text)) {
        riskPreference = 'LOW';
      } else if (/پرریسک|پر ریسک|high[\s-]?risk|aggressive|جسورانه/i.test(text)) {
        riskPreference = 'HIGH';
      } else if (/متوسط|medium[\s-]?risk|moderate|متعادل/i.test(text)) {
        riskPreference = 'MEDIUM';
      }

      const financialParams = {
        capital,
        timeHorizon,
        objective,
        riskPreference
      };

      return {
        ...intent,
        financialParams
      };
    },

    /**
     * Smart Clarification: Ask at most 1-2 targeted questions with options
     */
    clarify({ intent, context = {}, locale = 'fa' } = {}) {
      const isPersian = locale.startsWith('fa') || locale === 'fa';
      const fp = intent?.financialParams || {};
      const questions = [];

      if (!fp.riskPreference) {
        questions.push({
          id: 'risk_preference',
          question: isPersian
            ? 'برای طراحی دقیق استراتژی، حداکثر افت قابل قبول سرمایه‌ات چقدر است؟'
            : 'To customize your strategy, what is your maximum acceptable drawdown?',
          options: isPersian
            ? [
                { label: 'محتاطانه (تا ۵٪)', value: 'LOW' },
                { label: 'متعادل (تا ۱۵٪)', value: 'MEDIUM' },
                { label: 'جسورانه (تا ۳۰٪)', value: 'HIGH' }
              ]
            : [
                { label: 'Conservative (<5%)', value: 'LOW' },
                { label: 'Moderate (<15%)', value: 'MEDIUM' },
                { label: 'Aggressive (<30%)', value: 'HIGH' }
              ]
        });
      }

      if (!fp.timeHorizon && questions.length < 2) {
        questions.push({
          id: 'time_horizon',
          question: isPersian
            ? 'افق زمانی مدنظرت برای این سرمایه‌گذاری چقدر است؟'
            : 'What is your intended investment timeframe?',
          options: isPersian
            ? [
                { label: 'کوتاه‌مدت (۱ ماه)', value: '1 Month' },
                { label: 'میان‌مدت (۳ ماه)', value: '3 Months' },
                { label: 'بلندمدت (۱ سال)', value: '1 Year' }
              ]
            : [
                { label: '1 Month', value: '1 Month' },
                { label: '3 Months', value: '3 Months' },
                { label: '1 Year', value: '1 Year' }
              ]
        });
      }

      return {
        needsClarification: questions.length > 0,
        questions
      };
    },
    
    async route(intent) {
      const type = intent.type;
      
      const routing = {
        agents: ['intent-agent'],
        tools: [],
        requiresWallet: intent.requiresWallet || false,
        readOnly: intent.readOnly || false
      };
      
      if (['PORTFOLIO_ANALYSIS', 'REBALANCE'].includes(type)) {
        routing.agents.push('portfolio-agent', 'risk-agent', 'market-agent', 'strategy-agent');
      } else if (['MARKET_ANALYSIS', 'MARKET_CONTEXT', 'ANALYZE_TOKEN'].includes(type)) {
        routing.agents.push('market-agent', 'research-agent');
      } else if (['SMART_MONEY', 'WHALE'].includes(type)) {
        routing.agents.push('market-agent');
      } else if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'].includes(type)) {
        routing.agents.push('trading-agent', 'wallet-agent', 'risk-agent', 'guardian-agent', 'execution-agent', 'verification-agent');
      } else if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) {
        routing.agents.push('yield-agent', 'risk-agent', 'portfolio-agent', 'strategy-agent');
      } else if (['INVESTMENT_PLAN', 'GOAL', 'DCA'].includes(type)) {
        routing.agents.push('portfolio-agent', 'market-agent', 'yield-agent', 'risk-agent', 'strategy-agent', 'research-agent');
      } else if (['NEWS_SEARCH'].includes(type)) {
        routing.agents.push('research-agent', 'navigation-agent');
      } else if (['OPEN_CALM', 'PLAY_MUSIC'].includes(type)) {
        routing.agents.push('media-agent', 'navigation-agent');
      } else if (['NAVIGATION', 'ORDERS', 'WALLET_BALANCE'].includes(type)) {
        routing.agents.push('navigation-agent', 'wallet-agent');
      } else if (['EXECUTE_CURRENT', 'CONTINUE'].includes(type)) {
        routing.agents.push('execution-agent', 'verification-agent');
      }
      
      return routing;
    }
  };
}

export const intentAgent = createIntentAgent();
