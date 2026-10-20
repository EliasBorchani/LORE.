//! Entity ids: `feat.power_attack` for official content, `eberron:feat.dragon_blood` for a ruleset's content (the
//! ruleset's slug, then `:`). `:` means nothing in formulas, so the engine reads it inside statistic keys.

/// The parts of a well-shaped id: the ruleset slug (homebrew only), the type prefix and the name.
#[derive(Debug, PartialEq, Eq)]
pub struct Id<'a> {
    pub slug: Option<&'a str>,
    pub prefix: &'a str,
    pub name: &'a str,
}

pub fn parse(id: &str) -> Option<Id<'_>> {
    let (slug, rest) = match id.split_once(':') {
        Some((slug, rest)) => (Some(slug), rest),
        None => (None, id),
    };
    let (prefix, name) = rest.split_once('.')?;
    let word = |text: &str, digits: bool| {
        text.starts_with(|c: char| c.is_ascii_lowercase())
            && text
                .chars()
                .all(|c| c.is_ascii_lowercase() || c == '_' || (digits && c.is_ascii_digit()))
    };
    let shaped = slug.is_none_or(is_slug)
        && word(prefix, false)
        && !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    shaped.then_some(Id { slug, prefix, name })
}

/// A ruleset slug: chosen at creation, never changed, 3 to 31 characters.
pub fn is_slug(slug: &str) -> bool {
    (3..=31).contains(&slug.len())
        && slug.starts_with(|c: char| c.is_ascii_lowercase())
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// The id of `id` inside the ruleset `slug`: `feat.x` becomes `eberron:feat.x`.
pub fn in_ruleset(slug: &str, id: &str) -> String {
    format!("{slug}:{id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_official_and_homebrew_ids() {
        assert_eq!(
            parse("feat.power_attack"),
            Some(Id {
                slug: None,
                prefix: "feat",
                name: "power_attack"
            })
        );
        assert_eq!(
            parse("eberron:feat.dragon_blood"),
            Some(Id {
                slug: Some("eberron"),
                prefix: "feat",
                name: "dragon_blood"
            })
        );
        for bad in [
            "feat",
            "Feat.x",
            "feat.",
            ".x",
            "eb:feat.x",
            "eberron:",
            "a:b:feat.x",
            "feat.x y",
            "feat2.x",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }
}
