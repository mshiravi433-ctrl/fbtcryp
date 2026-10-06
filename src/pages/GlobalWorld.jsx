import PageTransition from '../components/PageTransition';
import AiGlobalIntelligence from '../components/ai/AiGlobalIntelligence.jsx';

/**
 * GLOBAL — «جهانی». The world console as a page of its own.
 * ---------------------------------------------------------------------------
 * It used to be the fifth tab of the News page. Six tabs shared one phone-wide
 * rail, the console squeezed into a 520px column, and the longest tab label
 * wrapped onto three lines. A dashboard of this size needs a room, so it left
 * the tabs: More → «جهانی» opens it, and #/news?tab=global (old links, a
 * refreshed WebView) is forwarded here by the News page.
 *
 * WIDTH. AppChrome puts `app-shell--wide` on the shell for this route, which
 * lifts the 520/680/760px phone column to ~1360px on wide screens. The
 * console itself switches to two columns at 900px (see GLOBAL_PAGE_STYLES), so
 * a desktop gets a dashboard rather than a stretched phone screen.
 *
 * The page only frames the console — every number on it comes from
 * AiGlobalIntelligence and its worldState model, unchanged by where it lives.
 */
export default function GlobalWorld() {
  return (
    <PageTransition className="page page--global">
      <AiGlobalIntelligence />
    </PageTransition>
  );
}
