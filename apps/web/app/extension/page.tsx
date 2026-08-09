/**
 * Extension install page. Built to survive a Chrome Web Store removal:
 * the Firefox build and the sideload path are first-class rows, not an
 * apologetic footnote, so no redesign is needed if the store listing goes.
 */
export default function ExtensionPage() {
  return (
    <main className="page prose">
      <h1 className="page-title">the extension</h1>
      <section className="card">
        <p>
          markets appear under tweets, inside x, where the fight is
          happening. see the matchup, stake without leaving the timeline,
          and spot the reply that is about to flip a post.
        </p>
      </section>
      <section className="card">
        <h2>get it</h2>
        <table className="table">
          <tbody>
            <tr>
              <td>chrome</td>
              <td className="muted">web store listing coming with launch</td>
            </tr>
            <tr>
              <td>firefox</td>
              <td className="muted">add-ons listing coming with launch</td>
            </tr>
            <tr>
              <td>sideload</td>
              <td className="muted">
                zip download for developer mode, always available regardless
                of store policy
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
