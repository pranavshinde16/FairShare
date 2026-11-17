import { createFileRoute, Link } from '@tanstack/react-router';
import { Contact, LegalPage } from '../features/legal/legal-page';

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
});

/**
 * The privacy notice (Blueprint 9.1, "Data protection": India's DPDP Act and GDPR). Every
 * statement here describes what the code does; change them together.
 */
function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice">
      <p>
        FairShare is an app for splitting shared expenses with friends. This notice explains what it
        stores about you, why, who else handles it, and how to delete it. In short: only what’s
        needed to split costs. No ads, no selling data, no tracking.
      </p>

      <h2>What FairShare stores</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address (sign-in codes are sent there), your
          name, and your Google profile picture if you sign in with Google. Your default currency
          and, if you add one, your UPI ID.
        </li>
        <li>
          <strong>What you and your groups enter:</strong> groups; the people in them, including the
          names (and email addresses, if given) of people who haven’t joined yet; expenses, payments
          and notes; and the history of every change.
        </li>
        <li>
          <strong>Signing in:</strong> a session for each device you’re signed in on, with its IP
          address and browser, kept until you sign out or for 30 days after you last use it. Sign-in
          codes are stored only in a scrambled (hashed) form and expire after 10 minutes.
        </li>
        <li>
          <strong>Technical logs:</strong> for each request, the time, the page or action, the
          result and your account ID, so problems can be found and fixed. Logs never contain your
          email address, sign-in codes or cookies.
        </li>
        <li>
          <strong>On your device:</strong> one cookie that keeps you signed in; your theme and each
          group’s last split, in the browser’s storage; and the app itself, cached so it opens
          quickly.
        </li>
      </ul>

      <h2>Who can see it</h2>
      <ul>
        <li>
          People in your groups see your name and picture, and the expenses and payments in the
          groups you share. Only you see your email address. Nobody outside a group can see anything
          in it.
        </li>
        <li>
          Service providers that run FairShare, who handle data only to do that: Railway (runs the
          app) and Neon (the database), both in Singapore; Resend (sends the sign-in emails); Google
          (only if you choose to sign in with Google); Sentry (error reports, with personal details
          removed); and, for typed expenses the app can’t read itself, Groq and Cloudflare (see
          below).
        </li>
        <li>Nobody else. FairShare doesn’t sell data, show ads, or use analytics or tracking.</li>
      </ul>

      <h2>Typed expenses</h2>
      <p>
        A sentence you type to fill in an expense (“Dinner 2400 with Rahul”) is read in your browser
        first. Most are read there and go nowhere until you save the expense.
      </p>
      <p>
        When the app can’t read all of a sentence (Hinglish, say, or “Rahul paid, only the two of
        us”), it sends the sentence to an AI service to read: Groq, in the United States, or
        Cloudflare Workers AI if Groq is unavailable. Sent with it: today’s date, the group’s
        currency and your name (so “I” and “me” mean you). Nothing else is sent: no other names from
        your groups, no email addresses, no balances. The answer only fills in the form; you check
        it and decide whether to save.
      </p>
      <ul>
        <li>
          FairShare keeps the sentence for 30 days, to see how well this works and to fix mistakes,
          then deletes it. Deleting your account deletes it at once.
        </li>
        <li>
          Groq says it keeps no inputs from these requests except, for up to 30 days, logs it needs
          to investigate abuse or failures. Cloudflare says it keeps neither the sentence nor the
          answer, and doesn’t use them to train AI models.
        </li>
      </ul>

      <h2>How long it’s kept</h2>
      <p>
        For as long as you have an account. When you delete it (
        <Link to="/settings/delete-account" className="text-primary underline underline-offset-4">
          Settings → Delete account
        </Link>
        ):
      </p>
      <ul>
        <li>
          your name, email address, picture and UPI ID are removed at once, and you’re signed out on
          every device;
        </li>
        <li>
          expenses and payments you were part of stay, because other people’s balances depend on
          them; you’re shown in them as “Deleted user”;
        </li>
        <li>sentences you typed for an AI service to read are deleted at once;</li>
        <li>copies in the database backups disappear as the backups expire, within 30 days.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can see and correct your details in Settings, and delete your account at any time. Under
        India’s Digital Personal Data Protection Act, 2023 (and similar laws elsewhere) you can also
        ask what FairShare holds about you, ask for it to be corrected or erased, or raise a
        concern. Contact: <Contact />.
      </p>

      <h2>Changes</h2>
      <p>
        When this notice changes, the date at the top changes too. Important changes are shown in
        the app before they take effect.
      </p>
    </LegalPage>
  );
}
