const inbox = "bookdjfnr@gmail.com";
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = value => value.replace(/[&<>"']/g, character => entities[character]);

function displayTime(value) {
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);
  return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? "PM" : "AM"}`;
}

function emailLayout(title, content) {
  return `<div style="max-width:620px;margin:auto;font:16px Arial,sans-serif;color:#17151e;border:1px solid #ded9ca">
    <div style="background:#17151e;color:#ffbf22;padding:24px"><strong>DJ FNR BOOKINGS</strong><h1 style="font-size:25px;margin:10px 0 0;color:white">${title}</h1></div>
    <div style="padding:24px;line-height:1.6">${content}</div>
  </div>`;
}

export async function onRequestPost({ request, env }) {
  const failure = status => Response.json({ ok: false }, { status });
  if (request.headers.get("Origin") !== new URL(request.url).origin) return failure(403);
  if (!env.RESEND_API_KEY || !env.BOOKING_FROM_EMAIL) return failure(503);
  const body = await request.text();
  if (body.length > 18000) return failure(413);
  const form = new URLSearchParams(body);
  const get = name => (form.get(name) || "").trim();
  const email = get("email");
  const start = get("start_time");
  const end = get("end_time");
  const organizer = get("organizer");
  const date = get("date");
  if (!/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email) || email.length > 254 ||
      !organizer || !get("location") || !get("type") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || !timePattern.test(start) ||
      !timePattern.test(end) || start === end) return failure(400);

  const eventDate = new Date(date + "T12:00:00Z");
  if (Number.isNaN(eventDate.getTime()) || eventDate.toISOString().slice(0, 10) !== date) return failure(400);
  const day = eventDate.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
  const sections = [
    ["Client Information", [["Name", organizer], ["Email", email]]],
    ["Event Information", [
      ["Event Date", day], ["Event Type", get("type")],
      ["Event Start", displayTime(start)], ["Event End", displayTime(end)],
      ["Overnight Event", end < start ? "Yes" : "No"], ["City / Location", get("location")]
    ]],
    ["Customer Message & Special Requests", [["Customer’s Full Message", get("details") || "To be discussed"]]]
  ];
  const summary = sections.map(([heading, rows]) =>
    `<h2 style="font-size:18px;margin:20px 0 8px">${heading}</h2><table style="width:100%;border-collapse:collapse">${rows.map(([label, value]) =>
      `<tr><th scope="row" style="width:38%;text-align:left;vertical-align:top;padding:9px 12px;background:#faf7ed;border-bottom:1px solid #ded9ca">${label}</th><td style="vertical-align:top;padding:9px 12px;border-bottom:1px solid #ded9ca;overflow-wrap:anywhere">${escape(value).replace(/\r?\n/g, "<br>")}</td></tr>`
    ).join("")}</table>`
  ).join("");
  const plainSummary = sections.map(([heading, rows]) =>
    [heading, ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n")
  ).join("\n\n");
  const subjectName = organizer.replace(/[\r\n]+/g, " ").slice(0, 100);
  const send = async (to, reply_to, subject, text, html) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.BOOKING_FROM_EMAIL, to: [to], reply_to, subject, text, html })
    });
    if (!response.ok) throw new Error(`Resend returned ${response.status}`);
  };

  try {
    await send(inbox, email, `NEW DJ FNR INQUIRY | ${subjectName} | ${date}`,
      plainSummary,
      emailLayout("New booking inquiry", summary + "<p>Reply to this email to follow up with the customer.</p>"));
  } catch (error) {
    console.error("Booking notification failed", error.message);
    return failure(502);
  }

  const message = `Thanks for reaching out to DJ FNR about your event on ${day}. We received your inquiry, and someone from DJ FNR Bookings will be in touch soon with availability and a quote for your event. Your event date is pending confirmation.`;
  try {
    await send(email, inbox, "We received your DJ FNR booking inquiry",
      `Hi ${organizer},\n\n${message}\n\nDJ FNR Bookings`,
      emailLayout("Thank you for your inquiry!", `<p>Hi ${escape(organizer)},</p><p>${message}</p><p>DJ FNR Bookings</p>`));
    return Response.json({ ok: true, confirmation: true });
  } catch (error) {
    console.error("Customer confirmation failed", error.message);
    return Response.json({ ok: true, confirmation: false });
  }
}
