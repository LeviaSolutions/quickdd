use chrono::{NaiveDate, Utc};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::process::Command;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LICENSE_FILE_NAME: &str = "license-state.json";
const TRIAL_MAX_DAYS: i64 = 7;
const TRIAL_MAX_SCENARIOS: u32 = 50;
const OFFLINE_GRACE_DAYS: i64 = 3;
const CLOCK_SKEW_TOLERANCE_SECS: i64 = 300;
const JWT_ISSUER: &str = "dd-analyst-license-server";

/// Ed25519 public key embedded at compile time.
const PUBLIC_KEY_PEM: &[u8] = include_bytes!("../keys/license-public.pem");

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Returned to the frontend via Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseResult {
    pub licensed: bool,
    pub is_trial: bool,
    pub reason: Option<String>,
    pub scenarios_used: u32,
    pub scenarios_max: u32,
    pub days_remaining: u32,
}

/// Persisted in the app data directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseState {
    pub key: Option<String>,
    pub activated: bool,
    pub first_launch: String,
    pub scenario_count: u32,
    pub license_token: Option<String>,
    pub last_server_time: Option<String>,
    pub device_id: String,
}

/// JWT payload returned by the license server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseTokenClaims {
    pub key: String,
    pub status: String,
    pub device_id: Option<String>,
    pub max_scenarios: u32,
    pub scenarios_used: u32,
    pub expires_at: Option<String>,
    pub server_time: String,
    pub exp: u64,
    pub iss: Option<String>,
}

/// Response from the Firebase activate / validate endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerResponse {
    #[serde(default)]
    pub activated: bool,
    #[serde(default)]
    pub valid: bool,
    pub token: Option<String>,
    #[serde(rename = "serverTime")]
    pub server_time: Option<String>,
    pub error: Option<String>,
    pub message: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn get_license_api_url() -> String {
    std::env::var("LICENSE_API_URL").unwrap_or_else(|_| {
        "https://us-central1-quickddlicense.cloudfunctions.net".to_string()
    })
}

/// Resolve the license state file path in the app data directory.
fn license_file_path() -> Result<std::path::PathBuf, String> {
    // Use the standard app data directory: ~/Library/Application Support/com.ddanalyst.app/
    let data_dir = dirs::data_dir()
        .ok_or_else(|| "Could not determine app data directory".to_string())?
        .join("com.ddanalyst.app");
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;
    Ok(data_dir.join(LICENSE_FILE_NAME))
}

/// Load `LicenseState` from a JSON file in the app data directory.
fn load_state() -> Result<Option<LicenseState>, String> {
    let path = license_file_path()?;
    match std::fs::read_to_string(&path) {
        Ok(json_str) => {
            let state: LicenseState = serde_json::from_str(&json_str)
                .map_err(|e| format!("Failed to parse license state: {}", e))?;
            Ok(Some(state))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read license state: {}", e)),
    }
}

/// Save `LicenseState` to a JSON file in the app data directory.
fn save_state(state: &LicenseState) -> Result<(), String> {
    let path = license_file_path()?;
    let json_str = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize state: {}", e))?;
    std::fs::write(&path, json_str)
        .map_err(|e| format!("Failed to write license state: {}", e))?;
    Ok(())
}

/// Create a fresh trial state.
fn new_trial_state(device_id: String) -> LicenseState {
    LicenseState {
        key: None,
        activated: false,
        first_launch: Utc::now().format("%Y-%m-%d").to_string(),
        scenario_count: 0,
        license_token: None,
        last_server_time: None,
        device_id,
    }
}

/// Verify a JWT string using the embedded Ed25519 public key.
fn verify_jwt(token: &str) -> Result<LicenseTokenClaims, String> {
    let key = DecodingKey::from_ed_pem(PUBLIC_KEY_PEM)
        .map_err(|e| format!("Failed to load public key: {}", e))?;
    let mut validation = Validation::new(Algorithm::EdDSA);
    validation.set_issuer(&[JWT_ISSUER]);
    let token_data = decode::<LicenseTokenClaims>(token, &key, &validation)
        .map_err(|e| format!("JWT verification failed: {}", e))?;
    Ok(token_data.claims)
}

/// Build a `LicenseResult` from the current state and optional JWT claims.
fn build_result_from_state(
    state: &LicenseState,
    claims: Option<&LicenseTokenClaims>,
) -> LicenseResult {
    if state.activated {
        if let Some(c) = claims {
            return LicenseResult {
                licensed: c.status == "active",
                is_trial: false,
                reason: if c.status == "active" {
                    None
                } else {
                    Some(format!("License status: {}", c.status))
                },
                scenarios_used: state.scenario_count,
                scenarios_max: c.max_scenarios,
                days_remaining: remaining_from_expires(c.expires_at.as_deref()),
            };
        }
        // Activated but no valid claims (token missing or expired)
        return LicenseResult {
            licensed: false,
            is_trial: false,
            reason: Some("License token missing or expired. Please re-activate.".to_string()),
            scenarios_used: state.scenario_count,
            scenarios_max: 0,
            days_remaining: 0,
        };
    }

    // No key — require activation upfront
    LicenseResult {
        licensed: false,
        is_trial: false,
        reason: Some("License key required".to_string()),
        scenarios_used: state.scenario_count,
        scenarios_max: TRIAL_MAX_SCENARIOS,
        days_remaining: 0,
    }
}

/// Calculate remaining trial days from first_launch ISO date string.
fn trial_days_remaining(first_launch: &str) -> i64 {
    let Ok(launch_date) = NaiveDate::parse_from_str(first_launch, "%Y-%m-%d") else {
        return 0;
    };
    let today = Utc::now().date_naive();
    let elapsed = (today - launch_date).num_days();
    (TRIAL_MAX_DAYS - elapsed).max(0)
}

/// Parse an optional expires_at string to remaining days.
fn remaining_from_expires(expires_at: Option<&str>) -> u32 {
    let Some(exp_str) = expires_at else {
        return u32::MAX;
    };
    let Ok(exp_date) = NaiveDate::parse_from_str(exp_str, "%Y-%m-%d") else {
        // Try ISO datetime
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(exp_str) {
            let remaining = (dt.date_naive() - Utc::now().date_naive()).num_days();
            return remaining.max(0) as u32;
        }
        return u32::MAX;
    };
    let remaining = (exp_date - Utc::now().date_naive()).num_days();
    remaining.max(0) as u32
}

/// Detect clock tampering: local time should not be earlier than
/// last_server_time minus a tolerance.
fn is_clock_tampered(last_server_time: &str) -> bool {
    let Ok(server_dt) = chrono::DateTime::parse_from_rfc3339(last_server_time) else {
        return false;
    };
    let now = Utc::now();
    let diff = server_dt.signed_duration_since(now).num_seconds();
    diff > CLOCK_SKEW_TOLERANCE_SECS
}

/// Check whether we are within the offline grace period.
fn within_offline_grace(last_server_time: &str) -> bool {
    let Ok(server_dt) = chrono::DateTime::parse_from_rfc3339(last_server_time) else {
        return false;
    };
    let elapsed = Utc::now()
        .signed_duration_since(server_dt)
        .num_days();
    elapsed <= OFFLINE_GRACE_DAYS
}

/// Validate a license key format: `DDA-XXXX-XXXX-XXXX` where X is a hex char.
fn validate_key_format(key: &str) -> Result<(), String> {
    let re = Regex::new(r"^DDA-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$")
        .map_err(|e| format!("Regex error: {}", e))?;
    if !re.is_match(key) {
        return Err("Invalid license key format. Expected DDA-XXXX-XXXX-XXXX (hex).".to_string());
    }
    Ok(())
}

/// Read the hardware device ID for the current platform.
fn read_device_id() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .map_err(|e| format!("Failed to run ioreg: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("IOPlatformUUID") {
                // Extract the UUID value between quotes
                if let Some(start) = line.find('"') {
                    let rest = &line[start + 1..];
                    if let Some(end) = rest.rfind('"') {
                        let uuid = &rest[..end];
                        // The line looks like: "IOPlatformUUID" = "UUID-HERE"
                        // We want the second quoted value
                        if uuid != "IOPlatformUUID" {
                            return Ok(uuid.to_string());
                        }
                    }
                }
            }
        }
        Err("Could not read IOPlatformUUID".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
            .map_err(|e| format!("Failed to read MachineGuid: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("MachineGuid") {
                if let Some(guid) = line.split_whitespace().last() {
                    return Ok(guid.to_string());
                }
            }
        }
        Err("Could not read MachineGuid from registry".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/machine-id")
            .map(|s| s.trim().to_string())
            .map_err(|e| format!("Failed to read /etc/machine-id: {}", e))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Unsupported platform for device ID".to_string())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// 1. Main license check -- loads state, verifies JWT if activated, checks
///    trial limits otherwise.
#[tauri::command]
pub async fn check_license() -> Result<LicenseResult, String> {
    let device_id = read_device_id()?;

    let mut state = match load_state()? {
        Some(s) => s,
        None => {
            let fresh = new_trial_state(device_id);
            save_state(&fresh)?;
            return Ok(build_result_from_state(&fresh, None));
        }
    };

    // --- Activated path ---
    if state.activated {
        if let Some(ref token) = state.license_token {
            // Verify JWT signature + expiry
            let claims = match verify_jwt(token) {
                Ok(c) => c,
                Err(e) => {
                    return Err(format!("License token invalid: {}", e));
                }
            };

            // Clock tampering detection
            if let Some(ref lst) = state.last_server_time {
                if is_clock_tampered(lst) {
                    // Force re-validation
                    return Err(
                        "Clock tampering detected. Please connect to the internet to re-validate your license.".to_string()
                    );
                }

                // Offline grace period check
                if !within_offline_grace(lst) {
                    return Err(
                        "Offline grace period expired. Please connect to the internet to re-validate your license.".to_string()
                    );
                }
            }

            // Update server time from claims
            state.last_server_time = Some(claims.server_time.clone());
            save_state(&state)?;

            return Ok(build_result_from_state(&state, Some(&claims)));
        }

        // Activated but no token -- should not happen; treat as trial fallback
        return Err("License activated but token missing. Please re-activate.".to_string());
    }

    // --- Trial path ---
    Ok(build_result_from_state(&state, None))
}

/// 2. Activate a license key by calling the server.
#[tauri::command]
pub async fn activate_license(key: String) -> Result<LicenseResult, String> {
    validate_key_format(&key)?;

    let device_id = read_device_id()?;
    let api_url = get_license_api_url();
    let url = format!("{}/activate", api_url);

    let body = serde_json::json!({
        "key": key,
        "deviceId": device_id,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error during activation: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Activation failed (HTTP {}): {}", status, text));
    }

    let server_resp: ServerResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse server response: {}", e))?;

    if let Some(ref err) = server_resp.error {
        return Err(format!("Activation error: {}", err));
    }

    let token = server_resp
        .token
        .ok_or_else(|| "Server did not return a license token".to_string())?;

    // Verify the returned JWT
    let claims = verify_jwt(&token)?;

    let state = LicenseState {
        key: Some(key),
        activated: true,
        first_launch: Utc::now().format("%Y-%m-%d").to_string(),
        scenario_count: claims.scenarios_used,
        license_token: Some(token),
        last_server_time: Some(
            server_resp
                .server_time
                .unwrap_or_else(|| claims.server_time.clone()),
        ),
        device_id,
    };

    save_state(&state)?;
    Ok(build_result_from_state(&state, Some(&claims)))
}

/// 3. Lightweight cached check -- no network, just read keychain.
#[tauri::command]
pub async fn get_trial_status() -> Result<LicenseResult, String> {
    let device_id = read_device_id()?;

    let state = match load_state()? {
        Some(s) => s,
        None => {
            let fresh = new_trial_state(device_id);
            save_state(&fresh)?;
            fresh
        }
    };

    if state.activated {
        if let Some(ref token) = state.license_token {
            // Attempt local JWT verification (no network)
            match verify_jwt(token) {
                Ok(claims) => return Ok(build_result_from_state(&state, Some(&claims))),
                Err(_) => {
                    // Token invalid locally, return degraded result
                    return Ok(LicenseResult {
                        licensed: false,
                        is_trial: false,
                        reason: Some("License token expired or invalid".to_string()),
                        scenarios_used: state.scenario_count,
                        scenarios_max: 0,
                        days_remaining: 0,
                    });
                }
            }
        }
    }

    Ok(build_result_from_state(&state, None))
}

/// 4. Increment scenario counter. Returns error if at limit.
#[tauri::command]
pub async fn increment_scenario() -> Result<LicenseResult, String> {
    let device_id = read_device_id()?;

    let mut state = match load_state()? {
        Some(s) => s,
        None => {
            let fresh = new_trial_state(device_id);
            save_state(&fresh)?;
            fresh
        }
    };

    // Determine max scenarios
    let max_scenarios = if state.activated {
        if let Some(ref token) = state.license_token {
            match verify_jwt(token) {
                Ok(claims) => claims.max_scenarios,
                Err(_) => return Err("License token invalid. Please re-activate.".to_string()),
            }
        } else {
            return Err("License token missing. Please re-activate.".to_string())
        }
    } else {
        TRIAL_MAX_SCENARIOS
    };

    if state.scenario_count >= max_scenarios {
        return Err(format!(
            "Scenario limit reached ({}/{}). Please upgrade your license.",
            state.scenario_count, max_scenarios
        ));
    }

    state.scenario_count += 1;
    save_state(&state)?;

    let claims = state
        .license_token
        .as_ref()
        .and_then(|t| verify_jwt(t).ok());
    Ok(build_result_from_state(&state, claims.as_ref()))
}

/// 5. Get device ID for the current platform.
#[tauri::command]
pub async fn get_device_id() -> Result<String, String> {
    read_device_id()
}

/// 6. Compute SHA-256 hash of the running executable for binary integrity verification.
/// This is preparation for tamper detection — CI will embed the expected hash.
fn compute_binary_hash() -> Result<String, String> {
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let bytes = std::fs::read(&exe_path).map_err(|e| format!("Failed to read exe: {}", e))?;
    let hash = Sha256::digest(&bytes);
    Ok(hex::encode(hash))
}

#[tauri::command]
pub async fn get_binary_hash() -> Result<String, String> {
    compute_binary_hash()
}

/// 7. One-time migration from localStorage legacy data.
#[tauri::command]
pub async fn migrate_license_data(legacy_data: String) -> Result<LicenseResult, String> {
    // Parse the legacy JSON
    let legacy: serde_json::Value = serde_json::from_str(&legacy_data)
        .map_err(|e| format!("Failed to parse legacy data: {}", e))?;

    let device_id = read_device_id()?;

    let first_launch = legacy
        .get("firstLaunch")
        .or_else(|| legacy.get("first_launch"))
        .and_then(|v| v.as_str())
        .unwrap_or(&Utc::now().format("%Y-%m-%d").to_string())
        .to_string();

    let scenario_count = legacy
        .get("scenarioCount")
        .or_else(|| legacy.get("scenario_count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let key = legacy
        .get("licenseKey")
        .or_else(|| legacy.get("key"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let activated = legacy
        .get("activated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let state = LicenseState {
        key,
        activated,
        first_launch,
        scenario_count,
        license_token: None, // Legacy data won't have a JWT; will need re-validation
        last_server_time: None,
        device_id,
    };

    save_state(&state)?;
    Ok(build_result_from_state(&state, None))
}
