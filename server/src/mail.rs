//! Outgoing mail over SMTP (implicit TLS, port 465), for invitations. Production uses Gmail with an app password.

use anyhow::Context;
use lettre::message::{Mailbox, MultiPart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use time::OffsetDateTime;

pub struct SmtpConfig {
    pub host: String,
    pub user: String,
    pub password: String,
    /// `Name <address>`; empty = `LORE. <user>`.
    pub from: Option<String>,
}

impl SmtpConfig {
    fn sender(&self) -> anyhow::Result<Mailbox> {
        match self.from.as_deref().filter(|from| !from.trim().is_empty()) {
            Some(from) => from
                .parse()
                .with_context(|| format!("MAIL_FROM {from}: not a mail address")),
            None => Ok(Mailbox::new(
                Some("LORE.".into()),
                self.user
                    .parse()
                    .with_context(|| format!("SMTP_USER {}: not a mail address", self.user))?,
            )),
        }
    }
}

const INVITATION_HTML: &str = include_str!("mail/invitation.html");

fn french_date(at: OffsetDateTime) -> String {
    let date = at.date();
    format!(
        "{:02}/{:02}/{}",
        date.day(),
        u8::from(date.month()),
        date.year()
    )
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn invitation_text(to: &str, link: &str, expires_at: OffsetDateTime) -> String {
    format!(
        "Bonjour,\n\n\
         Vous êtes invité·e à rejoindre LORE., le compagnon de jeu du groupe.\n\n\
         Pour créer votre compte, choisissez votre mot de passe ici :\n{link}\n\n\
         Votre identifiant sera cette adresse e-mail ({to}).\n\
         Le lien ne sert qu'une fois et reste valable jusqu'au {}.\n\n\
         Si vous n'attendiez pas ce message, ignorez-le : rien ne sera créé.\n",
        french_date(expires_at),
    )
}

fn invitation_html(to: &str, link: &str, expires_at: OffsetDateTime) -> String {
    INVITATION_HTML
        .replace("{{email}}", &escape_html(to))
        .replace("{{link}}", &escape_html(link))
        .replace("{{date}}", &french_date(expires_at))
}

/// HTML with the plain text as an alternative: mail programs that block HTML show the text, and spam filters
/// trust a mail with both more than HTML alone.
pub fn invitation_message(
    from: Mailbox,
    to: &str,
    link: &str,
    expires_at: OffsetDateTime,
) -> anyhow::Result<Message> {
    Ok(Message::builder()
        .from(from)
        .to(to
            .parse()
            .with_context(|| format!("{to}: not a mail address"))?)
        .subject("Invitation à LORE.")
        .multipart(MultiPart::alternative_plain_html(
            invitation_text(to, link, expires_at),
            invitation_html(to, link, expires_at),
        ))?)
}

pub async fn send_invitation(
    config: &SmtpConfig,
    to: &str,
    link: &str,
    expires_at: OffsetDateTime,
) -> anyhow::Result<()> {
    let message = invitation_message(config.sender()?, to, link, expires_at)?;
    let transport = AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)?
        .credentials(Credentials::new(
            config.user.clone(),
            config.password.clone(),
        ))
        .build();
    transport
        .send(message)
        .await
        .with_context(|| format!("cannot send the mail through {}", config.host))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_invitation_holds_the_link_and_the_date() {
        let config = SmtpConfig {
            host: "smtp.example.org".into(),
            user: "lore@example.org".into(),
            password: String::new(),
            from: None,
        };
        let expires = time::Date::from_calendar_date(2026, time::Month::October, 26)
            .unwrap()
            .midnight()
            .assume_utc();
        let link = "https://lore.example.org/invite#abc";
        let text = invitation_text("bob@mail.com", link, expires);
        assert!(text.contains(link) && text.contains("26/10/2026"), "{text}");
        let html = invitation_html("bob@mail.com", link, expires);
        assert_eq!(
            html.matches(link).count(),
            3,
            "button href, fallback href and text"
        );
        assert!(html.contains("bob@mail.com") && html.contains("26/10/2026"));
        assert!(!html.contains("{{"), "every placeholder is filled");
        assert_eq!(
            invitation_html("a<b>&\"c@d.e", link, expires)
                .matches("a&lt;b&gt;&amp;&quot;c@d.e")
                .count(),
            1
        );

        let message =
            invitation_message(config.sender().unwrap(), "bob@mail.com", link, expires).unwrap();
        let headers = String::from_utf8_lossy(&message.formatted()).into_owned();
        assert!(
            headers.contains("From: LORE. <lore@example.org>"),
            "{headers}"
        );
        assert!(headers.contains("To: bob@mail.com"), "{headers}");
        assert!(headers.contains("multipart/alternative"), "{headers}");
        assert!(
            headers.contains("text/plain") && headers.contains("text/html"),
            "{headers}"
        );
    }
}
