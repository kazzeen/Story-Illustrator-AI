
export interface DetailedError {
  code: string;
  title: string;
  description: string;
  timestamp: Date;
  technicalDetails?: string;
  failureReason?: string;
  category: "validation" | "resource" | "authentication" | "server" | "unknown";
  violationHeaders?: string[];
}

export interface ErrorExtractionContext {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  errorBody?: unknown;
  requestParams?: Record<string, unknown>;
}

export function extractDetailedError(context: ErrorExtractionContext): DetailedError {
  const { status, statusText, headers, errorBody } = context;
  const timestamp = new Date();
  
  // Normalize headers
  const normalizedHeaders: Record<string, string> = {};
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      normalizedHeaders[k.toLowerCase()] = String(v);
    }
  }

  // Default error
  const error: DetailedError = {
    code: status ? `HTTP_${status}` : "UNKNOWN_ERROR",
    title: "Generation Failed",
    description: typeof errorBody === "string" && errorBody.length > 0 && errorBody.length < 200 
      ? errorBody 
      : (normalizedHeaders["x-failure-reason"] || "An unknown error occurred during image generation."),
    timestamp,
    category: "unknown",
    technicalDetails: typeof errorBody === "string" ? errorBody : JSON.stringify(errorBody),
  };

  // 1. Check for Venice specific content violations and other relevant headers
  const safetyHeaders = [
    "x-venice-is-blurred",
    "x-venice-is-content-violation",
    "x-venice-is-adult-model-content-violation",
    "x-venice-contains-minor"
  ];
  
  const triggeredSafetyHeaders: string[] = [];
  const safetyHeaderDetails: string[] = [];
  const otherInterestingHeaders: string[] = [];

  // Check explicit safety headers first - capture actual violations (true values) separately
  for (const header of safetyHeaders) {
    if (normalizedHeaders[header] !== undefined) {
      const value = normalizedHeaders[header];
      // For boolean headers, show true/false clearly
      if (value === "true" || value === "True") {
        triggeredSafetyHeaders.push(`${header}: true`);
        safetyHeaderDetails.push(`${header}: true`);
      } else if (value === "false" || value === "False") {
        safetyHeaderDetails.push(`${header}: false`);
      } else {
        safetyHeaderDetails.push(`${header}: ${value}`);
      }
    }
  }

  // Scan for any other interesting headers (x-venice-*, x-failure-*, x-error-*)
  for (const [k, v] of Object.entries(normalizedHeaders)) {
    if (k.startsWith("x-venice-") || k.startsWith("x-failure-") || k.startsWith("x-error-")) {
      // Skip safety headers that we've already processed
      if (safetyHeaders.includes(k)) continue;
      // Skip standard tracing headers if they are not useful for end user
      if (k === "x-request-id") continue;
      
      otherInterestingHeaders.push(`${k}: ${v}`);
    }
  }

  // Include all safety header details in violation headers for complete visibility
  const allViolationHeaders = [...safetyHeaderDetails, ...otherInterestingHeaders];

  // Only return content violation if there are actual violations (true values)
  if (triggeredSafetyHeaders.length > 0) {
    // Create specific description based on which headers are violated
    let specificDescription = "The generated content violated safety policies.";
    const violatedHeaders = triggeredSafetyHeaders.map(h => h.split(':')[0]);
    
    if (violatedHeaders.includes("x-venice-is-content-violation")) {
      specificDescription = "Content violated general safety policies.";
    } else if (violatedHeaders.includes("x-venice-is-adult-model-content-violation")) {
      specificDescription = "Content violated adult content policies.";
    } else if (violatedHeaders.includes("x-venice-contains-minor")) {
      specificDescription = "Content inappropriately depicts minors.";
    } else if (violatedHeaders.includes("x-venice-is-blurred")) {
      specificDescription = "Content was blurred due to safety concerns.";
    }
    
    return {
      code: "CONTENT_VIOLATION",
      title: "Content Violation",
      description: specificDescription,
      timestamp,
      category: "validation",
      failureReason: "Safety filters triggered",
      technicalDetails: allViolationHeaders.join("\n"),
      violationHeaders: allViolationHeaders,
    };
  }
  
  // Always include Venice AI safety headers in violation headers for visibility
  if (safetyHeaderDetails.length > 0) {
    error.violationHeaders = allViolationHeaders;
  } else if (otherInterestingHeaders.length > 0) {
    error.violationHeaders = allViolationHeaders;
  }
  
  // If we found a failure reason header, use it as description
  if (normalizedHeaders["x-failure-reason"]) {
     error.description = normalizedHeaders["x-failure-reason"];
  }

  // 2. Check for explicit failure reasons in headers
  if (normalizedHeaders["x-failure-reason"]) {
    return {
      ...error,
      code: "PROVIDER_ERROR",
      title: "Provider Error",
      description: normalizedHeaders["x-failure-reason"],
      failureReason: normalizedHeaders["x-failure-reason"],
      technicalDetails: `x-failure-reason: ${normalizedHeaders["x-failure-reason"]}`,
      category: "server",
    };
  }

  // Check for generic warning header
  if (normalizedHeaders["warning"]) {
    return {
      ...error,
      code: "WARNING_HEADER",
      title: "Provider Warning",
      description: normalizedHeaders["warning"],
      failureReason: normalizedHeaders["warning"],
      technicalDetails: `warning: ${normalizedHeaders["warning"]}`,
      category: "server",
    };
  }

  // 3. Map HTTP Status Codes
  if (status) {
    switch (status) {
      case 400:
        error.code = "INVALID_PARAMETERS";
        error.title = "Invalid Request";
        error.description = "The request parameters were invalid. Please check your settings.";
        error.category = "validation";
        break;
      case 401:
      case 403:
        error.code = "AUTHENTICATION_FAILED";
        error.title = "Authentication Error";
        error.description = "You do not have permission to perform this action. Please sign in again.";
        error.category = "authentication";
        break;
      case 429:
        error.code = "RATE_LIMIT_EXCEEDED";
        error.title = "Too Many Requests";
        error.description = "You have exceeded the rate limit. Please try again later.";
        error.category = "resource";
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        error.code = "SERVER_ERROR";
        error.title = "Server Error";
        error.description = "The image generation server encountered an error. Please try again later.";
        error.category = "server";
        break;
      default:
        error.description = statusText || error.description;
    }
  }

  // 4. Extract details from body if available
  if (errorBody && typeof errorBody === "object") {
    const body = errorBody as Record<string, unknown>;
    if (body.error) {
        error.description = String(body.error);
    }
    if (body.message) {
        error.technicalDetails = String(body.message);
    }
    // Deep extraction for supabase function errors
    if (body.details && typeof body.details === "object") {
         // Recursive check could be added here, but simple extraction is usually enough
         error.technicalDetails = JSON.stringify(body.details);
    }
  }

  // Ensure technical details include critical headers if we fell through
  if (error.code === "SERVER_ERROR" || error.code.startsWith("HTTP_")) {
     const criticalHeaders = ["content-length", "x-request-id", "cf-ray"];
     const headerDetails = criticalHeaders
        .filter(k => normalizedHeaders[k])
        .map(k => `${k}: ${normalizedHeaders[k]}`)
        .join("\n");
     
     if (headerDetails) {
        error.technicalDetails = error.technicalDetails 
           ? `${error.technicalDetails}\n\n[Headers]\n${headerDetails}`
           : `[Headers]\n${headerDetails}`;
     }
  }

  return error;
}
