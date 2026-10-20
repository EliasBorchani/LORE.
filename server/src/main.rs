use std::io::{BufRead, IsTerminal};
use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use server::auth::{AuthConfig, Role, invitations, users};
use server::catalog::import::Target;
use server::mail::{self, SmtpConfig};
use server::state::Mailer;
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(about = "D&D tools server: catalog storage and API")]
struct Cli {
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: String,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the HTTP API.
    Serve {
        #[arg(long, env = "BIND_ADDR", default_value = "0.0.0.0:8080")]
        bind: String,
        /// Signs access tokens; at least 32 bytes. Changing it logs everyone out within 15 minutes.
        #[arg(long, env = "JWT_SECRET", hide_env_values = true)]
        jwt_secret: String,
        /// The address of the web app, start of invitation links sent from the app.
        #[arg(long, env = "APP_URL")]
        app_url: Option<String>,
        #[command(flatten)]
        smtp: SmtpArgs,
    },
    /// Import a catalog file (the engine's JSON format); only changed entities get a new version.
    Import {
        path: PathBuf,
        /// Official content of this RPG (default dnd35).
        #[arg(long)]
        rpg: Option<String>,
        /// Content of this ruleset instead (its ids start with `<slug>:`).
        #[arg(long, conflicts_with = "rpg")]
        ruleset: Option<String>,
        #[arg(long)]
        author: String,
        #[arg(long)]
        note: Option<String>,
        /// Report what would change, then roll back: nothing is written.
        #[arg(long)]
        dry_run: bool,
    },
    /// Write the current catalog of an RPG (default dnd35) or of a ruleset in the format `import` reads.
    ExportCatalog {
        path: PathBuf,
        #[arg(long)]
        rpg: Option<String>,
        #[arg(long, conflicts_with = "rpg")]
        ruleset: Option<String>,
    },
    /// Once, after `export`: today's table becomes the first group and its team content a private ruleset
    /// (docs/prd-multi.md, section 10). Prints the id map; nothing to do on a second run.
    MigrateGroups {
        /// Login of the owner: platform admin, group admin and ruleset owner.
        #[arg(long)]
        owner: String,
        #[arg(long)]
        group_name: String,
        /// Slug of the ruleset: team ids become `<slug>:<id>`, for good.
        #[arg(long)]
        ruleset: String,
        #[arg(long)]
        ruleset_name: String,
        /// Report what would change, then roll back: nothing is written.
        #[arg(long)]
        dry_run: bool,
    },
    /// Write the whole database, history included, into a new folder (one file per entity and per character).
    Export { dir: PathBuf },
    /// Load a folder written by `export` into an empty database, all or nothing.
    Restore { dir: PathBuf },
    /// Manage accounts (there is no public sign-up). Passwords are read from the terminal, or from stdin.
    User {
        #[command(subcommand)]
        command: UserCommand,
    },
}

#[derive(Subcommand)]
enum UserCommand {
    Add {
        login: String,
        #[arg(long, value_enum, default_value = "member")]
        role: Role,
    },
    /// Email an invitation link: the person chooses a password, and the email becomes the login. A new invitation
    /// replaces the pending one for the same email.
    Invite {
        email: String,
        #[arg(long, value_enum, default_value = "member")]
        role: Role,
        /// Print the link instead of mailing it (to send it some other way).
        #[arg(long)]
        no_email: bool,
        /// The address of the web app, start of the link.
        #[arg(long, env = "APP_URL")]
        app_url: String,
        #[arg(long, env = "SMTP_HOST", default_value = "smtp.gmail.com")]
        smtp_host: String,
        #[arg(long, env = "SMTP_USER")]
        smtp_user: Option<String>,
        #[arg(long, env = "SMTP_PASSWORD", hide_env_values = true)]
        smtp_password: Option<String>,
        /// `Name <address>`; default `LORE. <SMTP_USER>`.
        #[arg(long, env = "MAIL_FROM")]
        mail_from: Option<String>,
    },
    /// Change a login (for example to the person's email); characters stay attached.
    Rename { login: String, new_login: String },
    /// Set a new password; ends every session of the user.
    Password { login: String },
    /// Block logins and end every session of the user.
    Disable { login: String },
    /// Change what the account may create (defaults: 10 groups as admin, 10 rulesets, 20 pending invitations).
    Limits {
        login: String,
        #[arg(long)]
        groups: Option<i32>,
        #[arg(long)]
        rulesets: Option<i32>,
        #[arg(long)]
        invitations: Option<i32>,
    },
}

#[derive(clap::Args)]
struct SmtpArgs {
    #[arg(long, env = "SMTP_HOST", default_value = "smtp.gmail.com")]
    smtp_host: String,
    #[arg(long, env = "SMTP_USER")]
    smtp_user: Option<String>,
    #[arg(long, env = "SMTP_PASSWORD", hide_env_values = true)]
    smtp_password: Option<String>,
    /// `Name <address>`; default `LORE. <SMTP_USER>`.
    #[arg(long, env = "MAIL_FROM")]
    mail_from: Option<String>,
}

impl SmtpArgs {
    /// `None` when the user or the password is missing or empty.
    fn config(self) -> Option<SmtpConfig> {
        Some(SmtpConfig {
            host: self.smtp_host,
            user: self.smtp_user.filter(|user| !user.is_empty())?,
            password: self.smtp_password.filter(|password| !password.is_empty())?,
            from: self.mail_from,
        })
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let cli = Cli::parse();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&cli.database_url)
        .await
        .context("cannot connect to the database")?;
    server::MIGRATOR
        .run(&pool)
        .await
        .context("migrations failed")?;

    match cli.command {
        Command::Serve {
            bind,
            jwt_secret,
            app_url,
            smtp,
        } => {
            let mut state = server::AppState::new(pool, AuthConfig::new(jwt_secret.as_bytes())?);
            if let Some(app_url) = app_url.filter(|url| !url.is_empty()) {
                state = state.with_mailer(Mailer {
                    app_url,
                    smtp: smtp.config(),
                });
            }
            let listener = tokio::net::TcpListener::bind(&bind)
                .await
                .with_context(|| format!("cannot bind {bind}"))?;
            tracing::info!("listening on {bind}");
            axum::serve(listener, server::app(state))
                .with_graceful_shutdown(shutdown_signal())
                .await?;
        }
        Command::Import {
            path,
            rpg,
            ruleset,
            author,
            note,
            dry_run,
        } => {
            let text = std::fs::read_to_string(&path)
                .with_context(|| format!("cannot read {}", path.display()))?;
            let catalog: serde_json::Value = serde_json::from_str(&text)
                .with_context(|| format!("{} is not valid JSON", path.display()))?;
            let target = Target::find(&pool, rpg.as_deref(), ruleset.as_deref()).await?;
            if dry_run {
                let report = server::catalog::import::dry_run(
                    &pool,
                    &target,
                    &catalog,
                    &author,
                    note.as_deref(),
                )
                .await?;
                println!("dry run, nothing written: {report}");
            } else {
                let report = server::catalog::import::import(
                    &pool,
                    &target,
                    &catalog,
                    &author,
                    note.as_deref(),
                )
                .await?;
                println!("{report}");
            }
        }
        Command::ExportCatalog { path, rpg, ruleset } => {
            let target = Target::find(&pool, rpg.as_deref(), ruleset.as_deref()).await?;
            let catalog = server::catalog::export::export_catalog(&pool, &target).await?;
            server::archive::write_json(&path, &catalog)?;
            println!("catalog written to {}", path.display());
        }
        Command::Export { dir } => {
            let counts = server::archive::export::export(&pool, &dir).await?;
            println!("exported to {}: {counts}", dir.display());
        }
        Command::MigrateGroups {
            owner,
            group_name,
            ruleset,
            ruleset_name,
            dry_run,
        } => {
            let options = server::migrate::Options {
                owner,
                group_name,
                ruleset_slug: ruleset,
                ruleset_name,
            };
            let report = server::migrate::migrate_groups(&pool, &options, !dry_run).await?;
            if dry_run {
                println!("dry run, nothing written:");
            }
            println!("{report}");
        }
        Command::Restore { dir } => {
            let counts = server::archive::restore::restore(&pool, &dir).await?;
            println!("restored from {}: {counts}", dir.display());
        }
        Command::User { command } => match command {
            UserCommand::Add { login, role } => {
                let password = read_new_password()?;
                users::create(&pool, &login, &password, role).await?;
                println!("{login} created ({})", role.as_str());
            }
            UserCommand::Invite {
                email,
                role,
                no_email,
                app_url,
                smtp_host,
                smtp_user,
                smtp_password,
                mail_from,
            } => {
                let smtp = if no_email {
                    None
                } else {
                    Some(SmtpConfig {
                        host: smtp_host,
                        user: smtp_user.filter(|user| !user.is_empty()).context(
                            "SMTP_USER is not set (or use --no-email to print the link)",
                        )?,
                        password: smtp_password
                            .filter(|password| !password.is_empty())
                            .context(
                                "SMTP_PASSWORD is not set (or use --no-email to print the link)",
                            )?,
                        from: mail_from,
                    })
                };
                let created = invitations::create(&pool, &email, role).await?;
                let email = invitations::normalize_email(&email)?;
                let link = format!("{}/invite#{}", app_url.trim_end_matches('/'), created.token);
                let until = created.expires_at.date();
                match smtp {
                    None => println!(
                        "invitation for {email} ({}), valid until {until}:\n{link}",
                        role.as_str()
                    ),
                    Some(smtp) => {
                        match mail::send_invitation(&smtp, &email, &link, created.expires_at).await
                        {
                            Ok(()) => println!(
                                "invitation sent to {email} ({}), valid until {until}",
                                role.as_str()
                            ),
                            Err(error) => {
                                eprintln!("{error:#}");
                                println!(
                                    "the mail was not sent; the link still works, send it another way:\n{link}"
                                );
                            }
                        }
                    }
                }
            }
            UserCommand::Rename { login, new_login } => {
                users::rename(&pool, &login, &new_login).await?;
                println!("{login} is now {}", new_login.trim());
            }
            UserCommand::Password { login } => {
                let password = read_new_password()?;
                users::set_password(&pool, &login, &password).await?;
                println!("{login}: password changed, sessions ended");
            }
            UserCommand::Disable { login } => {
                users::disable(&pool, &login).await?;
                println!("{login}: disabled, sessions ended");
            }
            UserCommand::Limits {
                login,
                groups,
                rulesets,
                invitations,
            } => {
                let (groups, rulesets, invitations) =
                    users::set_limits(&pool, &login, groups, rulesets, invitations).await?;
                println!(
                    "{login}: {groups} groups as admin, {rulesets} rulesets, {invitations} pending invitations"
                );
            }
        },
    }
    Ok(())
}

/// Never from a command-line argument: it would stay in the shell history and the process list.
fn read_new_password() -> anyhow::Result<String> {
    if std::io::stdin().is_terminal() {
        let password = rpassword::prompt_password("New password: ")?;
        if rpassword::prompt_password("Again: ")? != password {
            anyhow::bail!("the passwords differ");
        }
        Ok(password)
    } else {
        let mut line = String::new();
        std::io::stdin().lock().read_line(&mut line)?;
        Ok(line.trim_end_matches(['\r', '\n']).to_owned())
    }
}

/// In a container the server is process 1, which gets no default SIGTERM handler: without this, `docker stop`
/// waits 10 s and then kills it.
async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.ok() };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler")
            .recv()
            .await
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<Option<()>>();
    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}
