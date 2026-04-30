use globset::{Glob, GlobMatcher};
use ignore::{DirEntry, WalkBuilder};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
struct Request {
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ResponseError>,
}

#[derive(Debug, Serialize)]
struct ResponseError {
    code: String,
    message: String,
}

fn success(id: String, result: Value) -> Response {
    Response {
        protocol_version: PROTOCOL_VERSION,
        id,
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn failure(id: String, code: &str, message: &str) -> Response {
    Response {
        protocol_version: PROTOCOL_VERSION,
        id,
        ok: false,
        result: None,
        error: Some(ResponseError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    }
}

fn fallback_id(raw: &str) -> String {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_string))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn handle_line(raw: &str) -> Response {
    let request = match serde_json::from_str::<Request>(raw) {
        Ok(request) => request,
        Err(_) => {
            return failure(
                fallback_id(raw),
                "invalid_request",
                "Request must be valid claude-yh runtime sidecar JSON.",
            )
        }
    };

    if request.protocol_version != PROTOCOL_VERSION {
        return failure(
            request.id,
            "incompatible_protocol",
            "Unsupported claude-yh runtime sidecar protocol version.",
        );
    }

    match request.method.as_str() {
        "runtime.hello" => success(
            request.id,
            json!({
                "name": "claude-yh-runtime-sidecar",
                "runtimeVersion": env!("CARGO_PKG_VERSION"),
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": [
                    "runtime.hello",
                    "runtime.echo",
                    "session.index",
                    "fs.glob",
                    "fs.grep",
                    "parity.manifest"
                ]
            }),
        ),
        "runtime.echo" => success(request.id, request.params),
        "session.index" => match build_session_index(&request.params) {
            Ok(result) => success(request.id, result),
            Err(message) => failure(request.id, "session_index_failed", &message),
        },
        "fs.glob" => match fs_glob(&request.params) {
            Ok(result) => success(request.id, result),
            Err(message) => failure(request.id, "fs_glob_failed", &message),
        },
        "fs.grep" => match fs_grep(&request.params) {
            Ok(result) => success(request.id, result),
            Err(message) => failure(request.id, "fs_grep_failed", &message),
        },
        "parity.manifest" => success(
            request.id,
            json!({
                "source": "claude-yh-runtime-sidecar",
                "scenarios": [
                    {
                        "id": "sidecar_hello",
                        "status": "implemented",
                        "owner": "rust-runtime-boundary"
                    },
                    {
                        "id": "echo_roundtrip",
                        "status": "implemented",
                        "owner": "rust-runtime-boundary"
                    },
                    {
                        "id": "unknown_method_error",
                        "status": "implemented",
                        "owner": "rust-runtime-boundary"
                    },
                    {
                        "id": "session_index_smoke",
                        "status": "implemented",
                        "owner": "rust-session-index"
                    },
                    {
                        "id": "fs_glob_smoke",
                        "status": "implemented",
                        "owner": "rust-fs-search"
                    },
                    {
                        "id": "fs_grep_smoke",
                        "status": "implemented",
                        "owner": "rust-fs-search"
                    }
                ]
            }),
        ),
        _ => failure(
            request.id,
            "method_not_found",
            "Unknown claude-yh runtime sidecar method.",
        ),
    }
}

fn build_session_index(params: &Value) -> Result<Value, String> {
    let config_dir = params
        .get("configDir")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .or_else(default_config_dir)
        .ok_or_else(|| "configDir is required when no home directory is available.".to_string())?;

    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    let project_filter = params.get("project").and_then(Value::as_str);
    let query_filter = params
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .map(str::to_lowercase);
    let projects_dir = config_dir.join("projects");

    let mut sessions = Vec::new();
    let Ok(projects) = fs::read_dir(&projects_dir) else {
        return Ok(json!({
            "source": "rust",
            "configDir": config_dir.to_string_lossy(),
            "sessions": [],
            "total": 0
        }));
    };

    for project_entry in projects.flatten() {
        let project_path = project_entry.file_name().to_string_lossy().to_string();
        if project_filter.is_some_and(|filter| filter != project_path) {
            continue;
        }

        let Ok(project_meta) = project_entry.metadata() else {
            continue;
        };
        if !project_meta.is_dir() {
            continue;
        }

        let Ok(files) = fs::read_dir(project_entry.path()) else {
            continue;
        };
        for file_entry in files.flatten() {
            let file_name = file_entry.file_name().to_string_lossy().to_string();
            if !file_name.ends_with(".jsonl") || file_name.starts_with("agent-") {
                continue;
            }

            let Ok(file_meta) = file_entry.metadata() else {
                continue;
            };
            if !file_meta.is_file() {
                continue;
            }

            let file_path = file_entry.path();
            let entries = read_jsonl_entries(&file_path);
            let modified = file_meta.modified().unwrap_or(UNIX_EPOCH);
            let item = json!({
                "id": file_name.trim_end_matches(".jsonl"),
                "projectPath": project_path,
                "filePath": file_path.to_string_lossy(),
                "createdAt": first_timestamp(&entries),
                "modifiedAt": system_time_iso(modified),
                "modifiedAtMs": system_time_ms(modified),
                "messageCount": count_messages(&entries),
                "title": extract_title(&entries)
            });

            if matches_query(&item, query_filter.as_deref()) {
                sessions.push(item);
            }
        }
    }

    sessions.sort_by(|a, b| {
        let a_ms = a.get("modifiedAtMs").and_then(Value::as_u64).unwrap_or(0);
        let b_ms = b.get("modifiedAtMs").and_then(Value::as_u64).unwrap_or(0);
        b_ms.cmp(&a_ms)
    });

    let total = sessions.len();
    if let Some(limit) = limit {
        sessions.truncate(limit);
    }

    Ok(json!({
        "source": "rust",
        "configDir": config_dir.to_string_lossy(),
        "sessions": sessions,
        "total": total
    }))
}

fn fs_glob(params: &Value) -> Result<Value, String> {
    let cwd = resolve_cwd(params)?;
    let pattern = required_str(params, "pattern")?;
    let limit = optional_usize(params, "limit").unwrap_or(100);
    let offset = optional_usize(params, "offset").unwrap_or(0);
    let matcher = compile_glob(pattern)?;

    let mut files = Vec::new();
    for entry in walk_readable_files(&cwd) {
        let rel = relative_slash_path(&cwd, entry.path());
        if matcher.is_match(&rel) {
            files.push(entry.path().to_string_lossy().to_string());
        }
    }
    files.sort();

    let total = files.len();
    let selected = files
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();

    Ok(json!({
        "source": "rust",
        "cwd": cwd.to_string_lossy(),
        "files": selected,
        "total": total,
        "truncated": total > offset.saturating_add(limit)
    }))
}

fn fs_grep(params: &Value) -> Result<Value, String> {
    let cwd = resolve_cwd(params)?;
    let pattern = required_str(params, "pattern")?;
    let glob_matcher = params
        .get("glob")
        .and_then(Value::as_str)
        .map(compile_glob)
        .transpose()?;
    let case_insensitive = params
        .get("caseInsensitive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let limit = optional_usize(params, "limit").unwrap_or(100);
    let offset = optional_usize(params, "offset").unwrap_or(0);
    let regex = RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .build()
        .map_err(|error| format!("invalid regex pattern: {error}"))?;

    let mut matches = Vec::new();
    for entry in walk_readable_files(&cwd) {
        let rel = relative_slash_path(&cwd, entry.path());
        if glob_matcher
            .as_ref()
            .is_some_and(|matcher| !matcher.is_match(&rel))
        {
            continue;
        }

        let Ok(content) = fs::read_to_string(entry.path()) else {
            continue;
        };
        for (index, line) in content.lines().enumerate() {
            if regex.is_match(line) {
                matches.push(json!({
                    "filePath": entry.path().to_string_lossy(),
                    "lineNumber": index + 1,
                    "line": line
                }));
            }
        }
    }

    matches.sort_by(|a, b| {
        let a_path = a.get("filePath").and_then(Value::as_str).unwrap_or("");
        let b_path = b.get("filePath").and_then(Value::as_str).unwrap_or("");
        let path_cmp = a_path.cmp(b_path);
        if path_cmp != std::cmp::Ordering::Equal {
            return path_cmp;
        }
        let a_line = a.get("lineNumber").and_then(Value::as_u64).unwrap_or(0);
        let b_line = b.get("lineNumber").and_then(Value::as_u64).unwrap_or(0);
        a_line.cmp(&b_line)
    });

    let total = matches.len();
    let selected = matches
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();

    Ok(json!({
        "source": "rust",
        "cwd": cwd.to_string_lossy(),
        "matches": selected,
        "total": total,
        "truncated": total > offset.saturating_add(limit)
    }))
}

fn resolve_cwd(params: &Value) -> Result<PathBuf, String> {
    let cwd = params
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    cwd.canonicalize()
        .map_err(|error| format!("cwd does not exist or cannot be read: {error}"))
}

fn required_str<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} is required"))
}

fn optional_usize(params: &Value, key: &str) -> Option<usize> {
    params
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
}

fn compile_glob(pattern: &str) -> Result<GlobMatcher, String> {
    Glob::new(pattern)
        .map_err(|error| format!("invalid glob pattern: {error}"))
        .map(|glob| glob.compile_matcher())
}

fn walk_readable_files(cwd: &Path) -> Vec<DirEntry> {
    let mut builder = WalkBuilder::new(cwd);
    builder
        .hidden(false)
        .ignore(true)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .parents(true)
        .filter_entry(should_keep_walk_entry);

    builder
        .build()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .is_some_and(|file_type| file_type.is_file())
        })
        .collect()
}

fn should_keep_walk_entry(entry: &DirEntry) -> bool {
    if !entry
        .file_type()
        .is_some_and(|file_type| file_type.is_dir())
    {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !matches!(name.as_ref(), ".git" | "node_modules" | "dist" | "target")
}

fn relative_slash_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn default_config_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !value.trim().is_empty() {
            return Some(PathBuf::from(value));
        }
    }

    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(|home| PathBuf::from(home).join(".claude-yh"))
}

fn read_jsonl_entries(file_path: &Path) -> Vec<Value> {
    let Ok(content) = fs::read_to_string(file_path) else {
        return Vec::new();
    };

    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                serde_json::from_str::<Value>(trimmed).ok()
            }
        })
        .collect()
}

fn first_timestamp(entries: &[Value]) -> Option<String> {
    entries.iter().find_map(|entry| {
        entry
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

fn count_messages(entries: &[Value]) -> usize {
    entries
        .iter()
        .filter(|entry| {
            matches!(
                entry.get("type").and_then(Value::as_str),
                Some("user" | "assistant")
            ) && entry
                .get("message")
                .and_then(|message| message.get("role"))
                .and_then(Value::as_str)
                .is_some()
        })
        .count()
}

fn extract_title(entries: &[Value]) -> String {
    entries
        .iter()
        .find_map(|entry| {
            if entry.get("type").and_then(Value::as_str) != Some("user")
                || entry.get("isMeta").and_then(Value::as_bool) == Some(true)
                || entry
                    .get("message")
                    .and_then(|message| message.get("role"))
                    .and_then(Value::as_str)
                    != Some("user")
            {
                return None;
            }

            entry
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(text_from_content)
                .map(|text| truncate_title(&text))
        })
        .unwrap_or_else(|| "Untitled Session".to_string())
}

fn text_from_content(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }

    content.as_array().and_then(|blocks| {
        blocks.iter().find_map(|block| {
            if block.get("type").and_then(Value::as_str) == Some("text") {
                block
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(str::to_string)
            } else {
                None
            }
        })
    })
}

fn truncate_title(text: &str) -> String {
    const MAX_TITLE_CHARS: usize = 80;
    let mut chars = text.chars();
    let title: String = chars.by_ref().take(MAX_TITLE_CHARS).collect();
    if chars.next().is_some() {
        format!("{title}...")
    } else {
        title
    }
}

fn system_time_ms(value: SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn system_time_iso(value: SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = value.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn matches_query(item: &Value, query: Option<&str>) -> bool {
    let Some(query) = query else {
        return true;
    };
    ["id", "title", "projectPath", "filePath"]
        .iter()
        .any(|key| {
            item.get(key)
                .and_then(Value::as_str)
                .map(|value| value.to_lowercase().contains(query))
                .unwrap_or(false)
        })
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();

    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }

        let response = handle_line(&line);
        if serde_json::to_writer(&mut stdout, &response).is_err() {
            break;
        }
        if writeln!(stdout).is_err() || stdout.flush().is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_reports_capabilities() {
        let response =
            handle_line(r#"{"protocolVersion":1,"id":"1","method":"runtime.hello","params":{}}"#);

        assert!(response.ok);
        let result = response.result.expect("hello should return result");
        assert_eq!(result["name"], "claude-yh-runtime-sidecar");
        assert_eq!(result["protocolVersion"], 1);
        assert!(result["capabilities"]
            .as_array()
            .expect("capabilities should be an array")
            .iter()
            .any(|capability| capability == "runtime.echo"));
        assert!(result["capabilities"]
            .as_array()
            .expect("capabilities should be an array")
            .iter()
            .any(|capability| capability == "session.index"));
    }

    #[test]
    fn echo_roundtrips_params() {
        let response = handle_line(
            r#"{"protocolVersion":1,"id":"2","method":"runtime.echo","params":{"value":42}}"#,
        );

        assert!(response.ok);
        assert_eq!(
            response.result.expect("echo should return params")["value"],
            42
        );
    }

    #[test]
    fn unknown_method_returns_structured_error() {
        let response =
            handle_line(r#"{"protocolVersion":1,"id":"3","method":"missing","params":{}}"#);

        assert!(!response.ok);
        assert_eq!(
            response.error.expect("error should be present").code,
            "method_not_found",
        );
    }

    #[test]
    fn protocol_mismatch_is_rejected() {
        let response =
            handle_line(r#"{"protocolVersion":999,"id":"4","method":"runtime.hello","params":{}}"#);

        assert!(!response.ok);
        assert_eq!(
            response.error.expect("error should be present").code,
            "incompatible_protocol",
        );
    }

    #[test]
    fn session_index_reads_jsonl_transcripts() {
        let root = std::env::temp_dir().join(format!(
            "claude-yh-session-index-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project = root.join("projects").join("-repo-a");
        fs::create_dir_all(&project).expect("test project dir should be created");
        fs::write(
            project.join("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
            [
                r#"{"type":"user","message":{"role":"user","content":"Index this session"},"timestamp":"2026-04-26T01:00:00.000Z"}"#,
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done"}]},"timestamp":"2026-04-26T01:01:00.000Z"}"#,
                "not json",
            ]
            .join("\n"),
        )
        .expect("session fixture should be written");
        fs::write(
            project.join("agent-worker.jsonl"),
            r#"{"type":"user","message":{"role":"user","content":"skip"}}"#,
        )
        .expect("agent fixture should be written");

        let request = json!({
            "protocolVersion": 1,
            "id": "5",
            "method": "session.index",
            "params": {
                "configDir": root.to_string_lossy()
            }
        });
        let response = handle_line(&request.to_string());

        fs::remove_dir_all(&root).ok();

        assert!(response.ok);
        let result = response.result.expect("session index should return result");
        assert_eq!(result["source"], "rust");
        assert_eq!(result["total"], 1);
        assert_eq!(result["sessions"][0]["projectPath"], "-repo-a");
        assert_eq!(
            result["sessions"][0]["id"],
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        );
        assert_eq!(result["sessions"][0]["messageCount"], 2);
        assert_eq!(result["sessions"][0]["title"], "Index this session");
        assert!(result["sessions"][0]["modifiedAt"].as_str().is_some());
    }

    #[test]
    fn session_index_filters_query_before_limit() {
        let root = std::env::temp_dir().join(format!(
            "claude-yh-session-index-query-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project_a = root.join("projects").join("-repo-a");
        let project_b = root.join("projects").join("-repo-b");
        fs::create_dir_all(&project_a).expect("project a should be created");
        fs::create_dir_all(&project_b).expect("project b should be created");
        fs::write(
            project_a.join("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
            r#"{"type":"user","message":{"role":"user","content":"Build memory index"}}"#,
        )
        .expect("session a should be written");
        fs::write(
            project_b.join("bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
            r#"{"type":"user","message":{"role":"user","content":"Fix provider config"}}"#,
        )
        .expect("session b should be written");

        let request = json!({
            "protocolVersion": 1,
            "id": "6",
            "method": "session.index",
            "params": {
                "configDir": root.to_string_lossy(),
                "query": "provider",
                "limit": 1
            }
        });
        let response = handle_line(&request.to_string());

        fs::remove_dir_all(&root).ok();

        assert!(response.ok);
        let result = response.result.expect("session index should return result");
        assert_eq!(result["total"], 1);
        assert_eq!(result["sessions"][0]["projectPath"], "-repo-b");
        assert_eq!(result["sessions"][0]["title"], "Fix provider config");
    }

    #[test]
    fn fs_glob_respects_default_exclusions_and_gitignore() {
        let root = std::env::temp_dir().join(format!(
            "claude-yh-fs-glob-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("src")).expect("src should be created");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("node_modules should be created");
        fs::create_dir_all(root.join("dist")).expect("dist should be created");
        fs::write(root.join(".gitignore"), "ignored.ts\n").expect("gitignore should be written");
        fs::write(root.join("src/app.ts"), "export const app = true\n")
            .expect("app fixture should be written");
        fs::write(root.join("ignored.ts"), "ignored\n").expect("ignored fixture should be written");
        fs::write(root.join("node_modules/pkg/index.ts"), "ignored\n")
            .expect("node_modules fixture should be written");
        fs::write(root.join("dist/bundle.ts"), "ignored\n")
            .expect("dist fixture should be written");

        let request = json!({
            "protocolVersion": 1,
            "id": "7",
            "method": "fs.glob",
            "params": {
                "cwd": root.to_string_lossy(),
                "pattern": "**/*.ts"
            }
        });
        let response = handle_line(&request.to_string());

        fs::remove_dir_all(&root).ok();

        assert!(response.ok);
        let result = response.result.expect("fs.glob should return result");
        assert_eq!(result["source"], "rust");
        assert_eq!(result["total"], 1);
        assert!(result["files"][0]
            .as_str()
            .expect("file path should be a string")
            .replace('\\', "/")
            .ends_with("src/app.ts"));
    }

    #[test]
    fn fs_grep_returns_matching_lines_with_glob_and_pagination() {
        let root = std::env::temp_dir().join(format!(
            "claude-yh-fs-grep-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("src")).expect("src should be created");
        fs::write(
            root.join("src/app.ts"),
            ["alpha", "Beta target", "gamma target"].join("\n"),
        )
        .expect("app fixture should be written");
        fs::write(root.join("src/app.md"), "target but ignored by glob")
            .expect("markdown fixture should be written");

        let request = json!({
            "protocolVersion": 1,
            "id": "8",
            "method": "fs.grep",
            "params": {
                "cwd": root.to_string_lossy(),
                "pattern": "target",
                "glob": "**/*.ts",
                "limit": 1
            }
        });
        let response = handle_line(&request.to_string());

        fs::remove_dir_all(&root).ok();

        assert!(response.ok);
        let result = response.result.expect("fs.grep should return result");
        assert_eq!(result["source"], "rust");
        assert_eq!(result["total"], 2);
        assert_eq!(result["truncated"], true);
        assert_eq!(result["matches"][0]["lineNumber"], 2);
        assert_eq!(result["matches"][0]["line"], "Beta target");
    }
}
