import { createFileRoute, Link } from '@tanstack/react-router';
import { Contact, LegalPage } from '../features/legal/legal-page';

export const Route = createFileRoute('/terms')({
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms apply when you use FairShare. By using it, you agree to them. They’re short;
        please read them.
      </p>

      <h2>What FairShare is</h2>
      <p>
        A free tool for recording shared expenses and working out who owes whom. FairShare doesn’t
        hold or move money: payments happen outside it (cash, UPI, a bank transfer), and recording
        one only notes that it happened. It isn’t financial, legal or tax advice.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be 18 or older, or use FairShare with a parent’s or guardian’s permission.</li>
        <li>
          Sign-in codes are sent to your email, so keep your email account secure. You’re
          responsible for what’s done with your account.
        </li>
        <li>
          Only add people you’re actually sharing costs with, and only their email address if they’d
          expect you to.
        </li>
      </ul>

      <h2>What you enter</h2>
      <p>
        What you enter stays yours. You let FairShare store it and show it to the people in the
        groups you share, which is what the app is for. The{' '}
        <Link to="/privacy" className="text-primary underline underline-offset-4">
          privacy notice
        </Link>{' '}
        says how it’s handled.
      </p>

      <h2>Fair use</h2>
      <p>
        Don’t try to reach other people’s groups, overload or attack the service, collect data from
        it automatically, or use it for anything unlawful. Limits on how often requests can be made
        apply to everyone. Accounts used this way can be suspended.
      </p>

      <h2>Accuracy and availability</h2>
      <p>
        FairShare works out balances carefully, rounding to the smallest unit of each currency, but
        check important amounts before paying them. It’s provided as it is: it may have bugs, may
        change, and may be unavailable at times. To the extent the law allows, FairShare isn’t
        responsible for losses from using it, including payments made between its users.
      </p>

      <h2>Ending</h2>
      <p>
        You can delete your account at any time in Settings. What happens to your data then is in
        the privacy notice.
      </p>

      <h2>Changes and contact</h2>
      <p>
        When these terms change, the date at the top changes too, and important changes are shown in
        the app first. These terms are governed by the laws of India. Questions: <Contact />.
      </p>
    </LegalPage>
  );
}
