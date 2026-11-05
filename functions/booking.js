const inbox = "bookdjfnr@gmail.com";
const emailPattern = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function displayTime(value) {
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);
  return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? "PM" : "AM"}`;
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return Response.json({ ok: false }, { status: 403 });
  }
  if (!env.RESEND_API_KEY || !env.BOOKING_FROM_EMAIL) {
    return Response.json({ ok: false }, { status: 503 });
  }
  const body = await request.text();
  if (body.length > 18000) return Response.json({ ok: false }, { status: 413 });
  const form = new URLSearchParams(body);
  const get = name => (form.get(name) || "").trim();
  const email = get("email");
  const start = get("start_time");
  const end = get("end_time");
  if (!emailPattern.test(email) || email.length > 254 ||
      !get("organizer") || !get("location") || !get("type") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(get("date")) ||
      !timePattern.test(start) || !timePattern.test(end) || start === end) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const send = async (to, reply_to, subject, text) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: env.BOOKING_FROM_EMAIL, to: [to], reply_to, subject, text })
    });
    if (!response.ok) throw new Error(`Resend returned ${response.status}`);
  };

  const schedule = `${get("date")} from ${displayTime(start)} to ${displayTime(end)}${end < start ? " the following day" : ""}`;
  try {
    await send(inbox, email, "New DJ FNR booking inquiry", [
      `Organizer: ${get("organizer")}`, `Email: ${email}`,
      `Event: ${get("type")}`, `Date and time: ${schedule}`,
      `Location: ${get("location")}`, `Details: ${get("details") || "To be discussed"}`
    ].join("\n"));
  } catch (error) {
    console.error("Booking notification failed", error.message);
    return Response.json({ ok: false }, { status: 502 });
  }
  try {
    await send(email, inbox, "DJ FNR received your booking inquiry",
      `Hi ${get("organizer")},\n\nThanks for reaching out to DJ FNR about your event on ${schedule}. We’ll follow up about availability and pricing. Your date is pending confirmation.\n\nDJ FNR Bookings`);
    return Response.json({ ok: true, confirmation: true });
  } catch (error) {
    console.error("Customer confirmation failed", error.message);
    return Response.json({ ok: true, confirmation: false });
  }
}
