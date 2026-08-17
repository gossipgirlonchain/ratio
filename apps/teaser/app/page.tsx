import { HandleForm } from "./HandleForm";

/** Screen 1: one input. The score gets them in the door. */
export default function Home() {
  return (
    <>
      <div className="hero">
        <h1>how much of a reply guy are you</h1>
        <p>
          a score out of 5,000 from your last 7 days of replies. no signup,
          no wallet, no email. then pick a fight.
        </p>
      </div>
      <HandleForm autoFocus />
      <p className="muted small">
        works on anyone. yes, that includes people who are not you.
      </p>
    </>
  );
}
