/*
 * Editorial directory for the External Agent Hub.
 *
 * These are links to third-party products, not reviewed provider records. They
 * must never be merged into the executable server catalogue. Keep every product
 * and pricing link on the vendor's own HTTPS domain, and keep plan descriptions
 * high-level so regional pricing/limits can be confirmed at the source.
 */
export const RECOMMENDATIONS_REVIEWED_ON = '2026-10-22';

export const RECOMMENDATION_CATEGORIES = Object.freeze([
  { id: 'all', fa: 'همه', en: 'All' },
  { id: 'general', fa: 'دستیار عمومی', en: 'General assistant' },
  { id: 'research', fa: 'پژوهش وب', en: 'Web research' },
  { id: 'coding', fa: 'کدنویسی', en: 'Coding' },
  { id: 'automation', fa: 'اتوماسیون', en: 'Automation' }
]);

export const RECOMMENDED_EXTERNAL_AGENTS = Object.freeze([
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    vendor: 'OpenAI',
    mark: 'AI',
    category: 'general',
    kind: { fa: 'دستیار چندمنظوره', en: 'General-purpose assistant' },
    summary: {
      fa: 'برای نوشتن، تحلیل، ایده‌پردازی و انجام کارهای روزمره؛ ابزارهای پیشرفته بر اساس طرح و دسترسی حساب محدود می‌شوند.',
      en: 'For writing, analysis, brainstorming, and everyday tasks. Advanced tools and multi-step features depend on plan and account availability.'
    },
    bestFor: {
      fa: 'شروع سریع برای کارهای عمومی و ساخت پیش‌نویس؛ پاسخ مهم را با منبع اصلی بررسی کنید.',
      en: 'A quick starting point for general tasks and first drafts; verify important claims against primary sources.'
    },
    freeAccess: {
      fa: 'طرح رایگان دارد؛ برخی ابزارها و میزان استفاده محدود است.',
      en: 'A free plan is available; some tools and usage are limited.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی با دسترسی یا سقف بالاتر؛ قابلیت‌ها بسته به طرح فرق می‌کند.',
      en: 'Paid plans offer different feature access and higher limits; availability varies by plan.'
    },
    productUrl: 'https://chatgpt.com/',
    pricingUrl: 'https://chatgpt.com/pricing/'
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    vendor: 'Perplexity AI',
    mark: 'P',
    category: 'research',
    kind: { fa: 'ایجنت پژوهش وب', en: 'Web research agent' },
    summary: {
      fa: 'جست‌وجوی وب و پاسخ‌های دارای ارجاع؛ برای بررسی چندمنبعی و گزارش اولیه مناسب است.',
      en: 'Web search with cited answers, useful for multi-source research and first-pass reports.'
    },
    bestFor: {
      fa: 'پیدا کردن منابع، مقایسه دیدگاه‌ها و تهیه گزارش قابل‌پیگیری؛ ارجاعات را باز کنید و خودتان راستی‌آزمایی کنید.',
      en: 'Finding sources, comparing viewpoints, and drafting traceable reports; open the citations and verify them yourself.'
    },
    freeAccess: {
      fa: 'جست‌وجوی پایه رایگان با سقف استفاده و قابلیت‌های محدودتر.',
      en: 'Free basic search with usage caps and fewer advanced features.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی برای پژوهش عمیق‌تر، مدل‌ها و منابع بیشتر.',
      en: 'Paid plans add higher research limits, model choices, and additional sources.'
    },
    productUrl: 'https://www.perplexity.ai/',
    pricingUrl: 'https://www.perplexity.ai/hub/pricing'
  },
  {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    mark: 'C',
    category: 'general',
    kind: { fa: 'دستیار عمومی و کدنویسی', en: 'General and coding assistant' },
    summary: {
      fa: 'برای تحلیل و نگارش اسناد، کارهای پژوهشی و کمک به کدنویسی؛ Claude Code و برخی قابلیت‌های پژوهشی به طرح وابسته‌اند.',
      en: 'Useful for document analysis, writing, research, and coding; Claude Code and some research features depend on plan.'
    },
    bestFor: {
      fa: 'خلاصه‌سازی اسناد بلند، بازنویسی دقیق و کمک به فهم یا تغییر کد.',
      en: 'Summarising long documents, careful editing, and help understanding or changing code.'
    },
    freeAccess: {
      fa: 'نسخه رایگان با سقف مصرف در دسترس است؛ پشتیبانی منطقه‌ای را بررسی کنید.',
      en: 'A free tier is available with usage limits; check supported regions.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی مصرف بیشتری می‌دهند و قابلیت‌هایی مانند Claude Code/Research را فعال می‌کنند.',
      en: 'Paid plans provide more usage and unlock features such as Claude Code and Research.'
    },
    productUrl: 'https://claude.ai/',
    pricingUrl: 'https://claude.com/pricing'
  },
  {
    id: 'gemini',
    name: 'Gemini',
    vendor: 'Google',
    mark: 'G',
    category: 'general',
    kind: { fa: 'دستیار چندرسانه‌ای', en: 'Multimodal assistant' },
    summary: {
      fa: 'دستیار چندرسانه‌ای گوگل با ابزارهای پژوهش و امکاناتی که می‌توانند با سرویس‌های Google همراه شوند.',
      en: 'Google’s multimodal assistant, with research tools and features that can work alongside Google services.'
    },
    bestFor: {
      fa: 'کار با متن، تصویر و محتوای روزمره؛ اگر اتصال به برنامه‌های Google را فعال می‌کنید، مجوزها را دقیق بررسی کنید.',
      en: 'Working with text, images, and everyday content; carefully review permissions before connecting Google apps.'
    },
    freeAccess: {
      fa: 'با حساب Google دسترسی رایگان پایه دارد؛ سقف‌ها و مدل‌های قابل‌دسترسی ممکن است تغییر کند.',
      en: 'A basic free tier is available with a Google Account; limits and model access can change.'
    },
    paidAccess: {
      fa: 'طرح‌های Google AI امکانات و سقف‌های متفاوتی دارند و دسترسی منطقه‌ای است.',
      en: 'Google AI subscriptions offer different features and limits, with regional availability.'
    },
    productUrl: 'https://gemini.google/',
    pricingUrl: 'https://gemini.google/subscriptions/'
  },
  {
    id: 'microsoft-copilot',
    name: 'Microsoft Copilot',
    vendor: 'Microsoft',
    mark: 'M',
    category: 'general',
    kind: { fa: 'دستیار عمومی و بهره‌وری', en: 'General and productivity assistant' },
    summary: {
      fa: 'برای پرسش‌های عمومی و کارهای روزمره؛ در بعضی اشتراک‌های Microsoft 365 به برنامه‌ها و اسناد کاری هم نزدیک می‌شود.',
      en: 'For general questions and everyday work; eligible Microsoft 365 subscriptions add deeper access to work apps and documents.'
    },
    bestFor: {
      fa: 'کاربران Microsoft 365 که می‌خواهند در کنار اسناد و ایمیل‌ها از دستیار استفاده کنند؛ مجوز و دسترسی فایل‌ها را بررسی کنید.',
      en: 'Microsoft 365 users who want an assistant alongside documents and email; review licensing and file permissions.'
    },
    freeAccess: {
      fa: 'نسخه رایگان برای کارهای عمومی دارد؛ قابلیت‌های Microsoft 365 جداگانه و وابسته به اشتراک‌اند.',
      en: 'A free version is available for general use; Microsoft 365 features depend on a separate subscription.'
    },
    paidAccess: {
      fa: 'قابلیت‌های بیشتر در طرح‌های Microsoft 365 شخصی یا کاری؛ قیمت و شرایط بر اساس منطقه و مجوز فرق می‌کند.',
      en: 'More features are available in Microsoft 365 personal or work plans; pricing and eligibility vary by region and license.'
    },
    productUrl: 'https://copilot.microsoft.com/',
    pricingUrl: 'https://www.microsoft.com/en-us/microsoft-365-copilot/pricing'
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    vendor: 'GitHub',
    mark: 'GH',
    category: 'coding',
    kind: { fa: 'ایجنت کدنویسی', en: 'Coding agent' },
    summary: {
      fa: 'کمک برنامه‌نویسی در محیط‌های توسعه و GitHub؛ قابلیت گفت‌وگو و ایجنت با سهمیه مصرف همراه است.',
      en: 'Coding assistance across development environments and GitHub; chat and agent features use plan-based allowances.'
    },
    bestFor: {
      fa: 'تکمیل کد، بررسی تغییرها و واگذاری بعضی کارهای مخزن؛ تغییرات و تست‌ها را پیش از ادغام بازبینی کنید.',
      en: 'Code completion, review, and delegating repository tasks; inspect changes and tests before merging.'
    },
    freeAccess: {
      fa: 'طرح Free با سقف محدود برای گفت‌وگو و استفاده از ایجنت دارد.',
      en: 'The Free plan includes limited chat and agent usage.'
    },
    paidAccess: {
      fa: 'طرح‌های شخصی و سازمانی با ظرفیت و امکانات بیشتر؛ مصرف مدل‌ها سهمیه‌بندی می‌شود.',
      en: 'Individual and business plans offer more capacity and features; model use is metered by allowances.'
    },
    productUrl: 'https://github.com/features/copilot',
    pricingUrl: 'https://github.com/features/copilot/plans'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    vendor: 'Anysphere',
    mark: 'Cu',
    category: 'coding',
    kind: { fa: 'محیط کدنویسی با ایجنت', en: 'Agentic coding environment' },
    summary: {
      fa: 'ویرایشگر کد با عامل‌های هوش مصنوعی برای فهم مخزن، برنامه‌ریزی و اعمال تغییرهای چندفایلی.',
      en: 'An AI coding editor with agents for understanding a codebase, planning, and making multi-file changes.'
    },
    bestFor: {
      fa: 'توسعه‌دهندگانی که می‌خواهند عامل را روی کد خودشان اجرا کنند؛ diff، دسترسی فایل‌ها و خروجی تست را بازبینی کنید.',
      en: 'Developers who want an agent to work in their own codebase; review diffs, file access, and test output.'
    },
    freeAccess: {
      fa: 'طرح رایگان با استفاده محدود از Agent و Chat دارد.',
      en: 'A free plan includes limited Agent and Chat usage.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی سقف بالاتر و بعضی امکانات ابری/خودکارسازی دارند.',
      en: 'Paid plans add higher limits and, depending on plan, cloud-agent and automation features.'
    },
    productUrl: 'https://cursor.com/',
    pricingUrl: 'https://cursor.com/pricing'
  },
  {
    id: 'zapier-agents',
    name: 'Zapier Agents',
    vendor: 'Zapier',
    mark: 'Z',
    category: 'automation',
    kind: { fa: 'پلتفرم ایجنت و اتوماسیون', en: 'Agent and automation platform' },
    summary: {
      fa: 'ساخت ایجنت‌هایی که می‌توانند در گردش‌کارهای متصل به برنامه‌های دیگر کار کنند؛ هر اقدام می‌تواند سهمیه مصرف کند.',
      en: 'Build agents that work across connected apps and workflows; agent activities may consume a usage allowance.'
    },
    bestFor: {
      fa: 'کارهای تکراری بین ابزارهای کاری؛ پیش از فعال‌کردن، دسترسی‌ها و اقدام‌های مجاز هر اتصال را محدود کنید.',
      en: 'Repeated work across business apps; limit permissions and permitted actions for each connection before enabling.'
    },
    freeAccess: {
      fa: 'پلن Agents Free با سقف فعالیت دارد.',
      en: 'An Agents Free plan is available with an activity cap.'
    },
    paidAccess: {
      fa: 'طرح‌های پولی ظرفیت بیشتر یا امکانات تیمی دارند؛ ممکن است جدا از پلن اصلی Zapier باشند.',
      en: 'Paid plans offer higher capacity or team features and may be separate from core Zapier plans.'
    },
    productUrl: 'https://zapier.com/agents',
    pricingUrl: 'https://zapier.com/pricing'
  },
  {
    id: 'n8n',
    name: 'n8n Agents',
    vendor: 'n8n',
    mark: 'n8n',
    category: 'automation',
    kind: { fa: 'سازندهٔ ایجنت و گردش‌کار', en: 'Agent and workflow builder' },
    summary: {
      fa: 'برای ساخت ایجنت‌های سفارشی و اتصال ابزارها در گردش‌کار؛ به پیکربندی و نگهداری فنی بیشتری نیاز دارد.',
      en: 'Build custom agents and connect tools in workflows; it requires more technical setup and maintenance.'
    },
    bestFor: {
      fa: 'کاربر فنی که کنترل بیشتری روی ابزارها و میزبانی می‌خواهد؛ مجوز، امنیت سرور و هزینه مدل را خودش مدیریت می‌کند.',
      en: 'Technical users who want more control over tools and hosting; you manage server security, licensing, and model costs.'
    },
    freeAccess: {
      fa: 'نسخه Community را می‌توان رایگان خودمیزبان کرد؛ هزینه سرور و مدل هوش مصنوعی ممکن است جدا باشد.',
      en: 'The Community edition can be self-hosted for free; server and AI-model costs may be separate.'
    },
    paidAccess: {
      fa: 'طرح‌های ابری و تجاری پولی با سهمیه اجرا و امکانات متفاوت دارد.',
      en: 'Paid cloud and business plans have different execution allowances and features.'
    },
    productUrl: 'https://n8n.io/ai-agents/',
    pricingUrl: 'https://n8n.io/pricing/'
  }
]);
