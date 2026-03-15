// booking.js
// Handle the booking form and Stripe payment

// Set your publishable key here; the user will replace this with their own
const stripe = Stripe("pk_test_YOUR_PUBLISHABLE_KEY");

const elements = stripe.elements();
const style = {
  base: {
    color: "#32325d",
    fontFamily: "Outfit, sans-serif",
    fontSmoothing: "antialiased",
    fontSize: "16px",
    "::placeholder": {
      color: "#a0aec0",
    },
  },
  invalid: {
    color: "#fa755a",
    iconColor: "#fa755a",
  },
};

const card = elements.create("card", { style });
card.mount("#card-element");

card.on("change", function (event) {
  const displayError = document.getElementById("card-errors");
  if (event.error) {
    displayError.textContent = event.error.message;
  } else {
    displayError.textContent = "";
  }
});

// pricing logic
function updateTotal() {
  const facility = document.getElementById("facility");
  const selected = facility.options[facility.selectedIndex];
  const price = parseFloat(selected.getAttribute("data-price")) || 0;
  document.getElementById("totalPrice").textContent = `$${price.toFixed(2)}`;
}
document.getElementById("facility").addEventListener("change", updateTotal);

const form = document.getElementById("bookingForm");
form.addEventListener("submit", async function (event) {
  event.preventDefault();
  document.getElementById("submitBtn").disabled = true;

  // gather booking data
  const data = {
    facility: form.facility.value,
    date: form.date.value,
    time: form.time.value,
    name: form.name.value,
    email: form.email.value,
    phone: form.phone.value,
  };

  // send to backend to create payment intent
  const response = await fetch("/create-payment-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const { clientSecret } = await response.json();

  const result = await stripe.confirmCardPayment(clientSecret, {
    payment_method: {
      card: card,
      billing_details: {
        name: data.name,
        email: data.email,
        phone: data.phone,
      },
    },
  });

  if (result.error) {
    // Show error and re-enable
    document.getElementById("card-errors").textContent = result.error.message;
    document.getElementById("submitBtn").disabled = false;
  } else {
    if (result.paymentIntent.status === "succeeded") {
      form.reset();
      updateTotal();
      showToast("✅ Booking confirmed! Check your email for details.");
      document.getElementById("submitBtn").disabled = false;
    }
  }
});

// simple toast function (already in main.js maybe) but just in case
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}
