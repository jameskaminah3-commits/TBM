// Tembea Bila Matata's story, in the owner's words. The home page and the
// About page both tell it from here, so a change is made in one place.
export const brandStory = {
  headline: "Your Coast trip, sorted.",
  hook: "The Coast is easy to fall in love with. Planning it? Not always.",
  problem:
    "A place to stay, a ride from the airport or SGR, something to do, a chef for the villa, things for the kids, and that listing you found online that looks almost too good. It quickly becomes a lot of calls, messages and guesswork.",
  answerLead: "That's where we come in.",
  answer: "Tembea Bila Matata is your people on the ground at the Kenyan Coast.",
  examples: [
    "A private villa in Diani or an apartment in Nyali.",
    "A pickup from the airport or SGR.",
    "A private chef for your stay in Watamu.",
    "A day on the water in Kilifi.",
    "A Facebook listing checked before you pay.",
    "Or a whole trip you don't have time to figure out.",
  ],
  paths: {
    browse: { question: "Know exactly what you want?", answer: "Browse and book." },
    tellUs: { question: "Starting with just a budget and a few ideas?", answer: "Tell us, and we'll put the pieces together." },
    sendFirst: { question: "Found something elsewhere?", answer: "Send it to us first." },
  },
  promises: [
    "We check places before our guests arrive.",
    "We meet them when they get here.",
    "And when something isn't right, we fix it.",
  ],
  closing: [
    "We're not here to hand you a list of places to book.",
    "We're here to make your Coast trip happen, and to be there when you need us.",
  ],
  // A button label, so no full stop.
  callToAction: "Tell us what you need",
} as const;
