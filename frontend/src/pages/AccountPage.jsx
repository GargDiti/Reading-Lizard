import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/navbar";
import "./AccountPage.css";

function getInitials(name, email) {
  const label = (name || email || "Reader").trim();
  const parts = label.includes("@") ? [label.split("@")[0]] : label.split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
}

function AccountPage() {
  const { user } = useAuth();
  const joinedDate = user?.createdAt
    ? new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(user.createdAt))
    : null;

  return (
    <div className="account-page">
      <Navbar />
      <main className="account-main">
        <Link className="account-back-link" to="/research">← Back to my research</Link>
        <div className="account-heading"><p className="account-eyebrow">YOUR ACCOUNT</p><h1>Profile</h1><p>Your Reading Lizard account details.</p></div>
        <section className="account-card" aria-labelledby="account-profile-heading">
          <div className="account-profile-summary"><span className="account-avatar" aria-hidden="true">{getInitials(user?.name, user?.email)}</span><div><h2 id="account-profile-heading">{user?.name || "Reader"}</h2><p>{user?.email}</p></div></div>
          <dl className="account-details">
            <div><dt>Display name</dt><dd>{user?.name || "Not provided"}</dd></div>
            <div><dt>Email address</dt><dd>{user?.email || "Not provided"}</dd></div>
            {joinedDate && <div><dt>Member since</dt><dd>{joinedDate}</dd></div>}
          </dl>
          <p className="account-readonly-note">Your profile details are read-only in this workspace.</p>
        </section>
      </main>
    </div>
  );
}

export default AccountPage;
