(function () {
  // Paste this into Powerful Form Builder's "After form loaded" script.
  // Configure /apps/rf-leads as a Shopify App Proxy for the RF Tools endpoint.
  // Versioned so a stale copy of the old script (another form's saved
  // config, a cached page) can never block this one from installing.
  if (window.__rfLeadCaptureV2Installed) {
    return;
  }
  window.__rfLeadCaptureV2Installed = true;
  // Also claim the old flag so an old copy that runs later stays inert.
  window.__rfLeadCaptureInstalled = true;

  console.log("[RF Leads] Script loaded at", new Date().toISOString());

  var FIELD_MAP = {
    firstName: "text-5",
    lastName: "text-6",
    email: "email",
    phone: "phone-1",
    message: "textarea-1"
  };

  var WEBHOOK = "/apps/rf-leads";
  var MAX_FILE_BYTES = 20 * 1024 * 1024;
  var MAX_FILES = 3;

  function logForms(when) {
    var forms = document.querySelectorAll("form");
    console.log("[RF Leads] At " + when + ": " + forms.length + " form(s)");
  }

  function addField(fields, key, value) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      if (!Array.isArray(fields[key])) {
        fields[key] = [fields[key]];
      }
      fields[key].push(value);
      return;
    }
    fields[key] = value;
  }

  function firstValue(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  function textValue(value) {
    var first = firstValue(value);
    return typeof first === "string" ? first.trim() : "";
  }

  function mapContact(fields) {
    var mapped = {};
    var name = [
      textValue(fields[FIELD_MAP.firstName]),
      textValue(fields[FIELD_MAP.lastName])
    ].filter(Boolean).join(" ");

    if (name) {
      mapped.name = name;
    }

    ["email", "phone", "message"].forEach(function (key) {
      var value = textValue(fields[FIELD_MAP[key]]);
      if (value) {
        mapped[key] = value;
      }
    });

    return mapped;
  }

  function contentType(file) {
    var supplied = (file.type || "").toLowerCase();
    var supported = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/heic",
      "image/heif",
      "image/gif",
      "image/svg+xml"
    ];
    if (supported.indexOf(supplied) !== -1) {
      return supplied;
    }
    if (supplied && supplied !== "application/octet-stream") {
      return null;
    }

    var extension = file.name.toLowerCase().split(".").pop();
    return {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      heic: "image/heic",
      heif: "image/heif",
      gif: "image/gif",
      svg: "image/svg+xml"
    }[extension] || null;
  }

  function responseJson(response) {
    return response.json().catch(function () {
      return {};
    }).then(function (body) {
      if (!response.ok) {
        throw new Error(body.error || "Request failed with status " + response.status);
      }
      return body;
    });
  }

  function uploadDrawing(drawing) {
    var file = drawing.file;
    var type = contentType(file);
    if (!type) {
      return Promise.reject(new Error(file.name + " must be a PDF, PNG, JPEG, HEIC, HEIF, GIF, or SVG file."));
    }
    if (!file.size) {
      return Promise.reject(new Error(file.name + " is empty."));
    }
    if (file.size > MAX_FILE_BYTES) {
      return Promise.reject(new Error(file.name + " is over 20 MB."));
    }

    return fetch(WEBHOOK + "?action=create-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filename: file.name,
        content_type: type,
        size_bytes: file.size
      })
    })
      .then(responseJson)
      .then(function (intent) {
        var uploadBody = new FormData();
        var fileBody = file.type === intent.content_type
          ? file
          : file.slice(0, file.size, intent.content_type);
        uploadBody.append("cacheControl", "3600");
        uploadBody.append("", fileBody, file.name);

        return fetch(intent.signed_url, {
          method: "PUT",
          headers: intent.upload_headers,
          body: uploadBody
        }).then(function (response) {
          if (!response.ok) {
            throw new Error(file.name + " upload failed with status " + response.status + ".");
          }
          return {
            path: intent.path,
            field_name: drawing.fieldName,
            filename: file.name,
            content_type: intent.content_type,
            size_bytes: file.size
          };
        });
      });
  }

  function sendLead(form, fields, mapped, drawings) {
    var selected = drawings.slice(0, MAX_FILES);
    var earlyErrors = drawings.length > MAX_FILES
      ? ["Only the first " + MAX_FILES + " project drawings were uploaded."]
      : [];

    var jobs = selected.map(function (drawing) {
      return uploadDrawing(drawing)
        .then(function (upload) {
          return { upload: upload, error: null };
        })
        .catch(function (error) {
          console.error("[RF Leads] Drawing upload error:", error);
          return { upload: null, error: error.message || String(error) };
        });
    });

    return Promise.all(jobs).then(function (results) {
      var uploads = results.map(function (result) {
        return result.upload;
      }).filter(Boolean);
      var uploadErrors = earlyErrors.concat(results.map(function (result) {
        return result.error;
      }).filter(Boolean));

      return fetch(WEBHOOK, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: fields,
          mapped: mapped,
          uploads: uploads,
          upload_errors: uploadErrors,
          form_id: form.id || form.getAttribute("data-id") || null,
          page_url: window.location.href,
          source_detail: document.title
        }),
        keepalive: true
      });
    }).then(function (response) {
      console.log("[RF Leads] Webhook status:", response.status);
      return responseJson(response);
    }).then(function (body) {
      console.log("[RF Leads] Webhook response:", body);
    }).catch(function (error) {
      console.error("[RF Leads] Webhook error:", error);
    });
  }

  logForms("startup");

  setTimeout(function () {
    logForms("+1s");
  }, 1000);

  setTimeout(function () {
    logForms("+3s");
  }, 3000);

  // A click and a real submit event can both fire for one submission, and a
  // visitor can retry after a validation error. One signature per minute is
  // enough; the webhook's own 24-hour dedupe catches anything slower.
  var recentSends = [];

  function alreadySent(signature, now) {
    recentSends = recentSends.filter(function (entry) {
      return now - entry.at < 60000;
    });
    for (var i = 0; i < recentSends.length; i++) {
      if (recentSends[i].signature === signature) {
        return true;
      }
    }
    return false;
  }

  function captureForm(form, via) {
    console.log("[RF Leads] Submit captured on form:", form, "via", via);

    var fields = {};
    var drawings = [];

    try {
      new FormData(form).forEach(function (value, key) {
        if (typeof File !== "undefined" && value instanceof File) {
          if (value.size > 0) {
            drawings.push({ fieldName: key, file: value });
            addField(fields, key, value.name);
          }
          return;
        }
        addField(fields, key, value);
      });
    } catch (error) {
      console.error("[RF Leads] FormData error:", error);
    }

    var mapped = mapContact(fields);
    if (!mapped.email && !mapped.phone) {
      // A wizard step or an empty click; the final page carries the contact.
      console.log("[RF Leads] No contact fields yet; not sending.");
      return;
    }

    var signature = JSON.stringify(mapped);
    var now = Date.now();
    if (alreadySent(signature, now)) {
      console.log("[RF Leads] Duplicate capture ignored.");
      return;
    }
    recentSends.push({ signature: signature, at: now });

    console.log("[RF Leads] Drawing files:", drawings.map(function (drawing) {
      return drawing.file.name;
    }));

    sendLead(form, fields, mapped, drawings);
  }

  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;

      if (
        !form ||
        form.tagName !== "FORM" ||
        typeof form.closest !== "function" ||
        !form.closest(".globo-form-app")
      ) {
        return;
      }

      captureForm(form, "submit event");
    },
    true
  );

  // Powerful Form Builder's wizard submits over AJAX without dispatching a
  // DOM submit event, so the listener above never fires for it (verified on
  // the BC form, 2026-09-02). Reading the form when its submit button is
  // pressed catches those; the signature guard keeps the two paths from
  // sending twice.
  document.addEventListener(
    "click",
    function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }
      var button = target.closest("button[type=\"submit\"], input[type=\"submit\"], .globo-form-submit");
      if (!button || !button.closest(".globo-form-app")) {
        return;
      }
      var form = button.closest("form");
      if (!form) {
        return;
      }
      captureForm(form, "submit button click");
    },
    true
  );
})();
