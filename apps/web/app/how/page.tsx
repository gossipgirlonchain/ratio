/**
 * How it works. Crypto-native audience at launch: short, assumes
 * familiarity. Server component; no fixtures, no mount gate.
 */
export default function HowPage() {
  return (
    <main className="page prose">
      <h1 className="page-title">how it works</h1>

      <section className="card">
        <h2>the game</h2>
        <p>
          someone tweets. someone answers. anyone tags the bot on the answer
          and a 24 hour market opens between the two tweets. whichever has
          more likes when the clock runs out wins. the likes are the
          referee, and an exact tie goes to the original.
        </p>
        <p>
          the answer has to be under 12 hours old when it gets tagged, both
          tweets have to be public, the two accounts have to be different
          people, and you cannot open a market on your own post.
        </p>
      </section>

      <section className="card">
        <h2>the money</h2>
        <p>
          staking buys outcome tokens on a live curve. the more money
          already on a person, the fewer tokens your dollar buys, so early
          and contrarian money genuinely pays better. watching the quote
          fall as you raise the amount is the market telling you it is
          thin.
        </p>
        <p>
          at settlement the winning tokens split the whole staked amount,
          minus the 1.25% fee. quotes are indicative: the curve moves
          between your quote and your transaction landing.
        </p>
        <p>
          you can sell out of an open market at the current curve price. an
          exit fee ramps up as the clock runs down, so leaving early is
          cheap and leaving late is not.
        </p>
      </section>

      <section className="card">
        <h2>the fees</h2>
        <p>
          every trade pays 1.25%, split five ways: the original, the reply,
          whoever tagged the market open, the ratio treasury, and the
          doppler protocol. both people being argued over earn from every
          trade, whether they win or lose, whether they have ever used this
          site or not. unclaimed fees wait on your profile.
        </p>
      </section>

      <section className="card">
        <h2>voids</h2>
        <p>
          if either tweet is deleted, either account goes private or gets
          suspended, or the winning tweet ends up with no money on it, the
          market voids and everyone exits at the curve. no fee on that.
        </p>
      </section>
    </main>
  );
}
