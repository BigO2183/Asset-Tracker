const supabaseUrl = "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE";
const supabaseAnonKey = "PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE";

const storageKey = "equipment-asset-tracker-assets";
const historyStorageKey = "equipment-asset-tracker-history";

const starterEquipment = [
  {
    assetId: "EQ-001",
    equipmentName: "Milwaukee Drill",
    category: "Power Tool",
    barcode: "EQ-001",
    status: "Available",
    location: "Warehouse",
    currentHolder: "",
    projectJob: "",
    checkoutDate: "",
    returnDate: "",
    condition: "Good",
    notes: "Test asset",
  },
];

const fields = {
  assetId: document.querySelector("#asset-id"),
  equipmentName: document.querySelector("#asset-name"),
  category: document.querySelector("#asset-category"),
  barcode: document.querySelector("#asset-barcode"),
  status: document.querySelector("#asset-status"),
  listStatus: document.querySelector("#list-status"),
  location: document.querySelector("#asset-location"),
  currentHolder: document.querySelector("#asset-holder"),
  projectJob: document.querySelector("#asset-project"),
  checkoutDate: document.querySelector("#asset-checkout-date"),
  returnDate: document.querySelector("#asset-return-date"),
  assetLink: document.querySelector("#asset-link"),
  condition: document.querySelector("#asset-condition"),
  notes: document.querySelector("#asset-notes"),
  qrCode: document.querySelector("#qr-code"),
  qrLabel: document.querySelector("#qr-label"),
  qrLinkText: document.querySelector("#qr-link-text"),
  printQrButton: document.querySelector("#print-qr-button"),
  holderInput: document.querySelector("#holder-input"),
  projectInput: document.querySelector("#project-input"),
  checkoutForm: document.querySelector("#checkout-form"),
  returnButton: document.querySelector("#return-button"),
  historyList: document.querySelector("#history-list"),
};

const hasSupabaseConfig =
  supabaseUrl.startsWith("https://") &&
  !supabaseAnonKey.includes("PASTE_YOUR");

const db = hasSupabaseConfig
  ? window.supabase.createClient(supabaseUrl, supabaseAnonKey)
  : null;

let equipment = [];
let history = [];
let selectedAsset = null;

function toAppAsset(row) {
  return {
    assetId: row.asset_id,
    equipmentName: row.equipment_name,
    category: row.category || "",
    barcode: row.barcode || "",
    status: row.status || "Available",
    location: row.location || "",
    currentHolder: row.current_holder || "",
    projectJob: row.project_job || "",
    checkoutDate: row.checkout_date || "",
    returnDate: row.return_date || "",
    condition: row.condition || "",
    notes: row.notes || "",
  };
}

function toDatabaseAsset(asset) {
  return {
    asset_id: asset.assetId,
    equipment_name: asset.equipmentName,
    category: asset.category,
    barcode: asset.barcode,
    status: asset.status,
    location: asset.location,
    current_holder: asset.currentHolder,
    project_job: asset.projectJob,
    checkout_date: asset.checkoutDate || null,
    return_date: asset.returnDate || null,
    condition: asset.condition,
    notes: asset.notes,
  };
}

function toAppHistory(row) {
  return {
    assetId: row.asset_id,
    action: row.action,
    holder: row.holder || "",
    projectJob: row.project_job || "",
    date: formatDate(row.action_date),
  };
}

function loadLocalEquipment() {
  const savedEquipment = localStorage.getItem(storageKey);

  if (!savedEquipment) {
    return starterEquipment;
  }

  try {
    return JSON.parse(savedEquipment);
  } catch (error) {
    return starterEquipment;
  }
}

function saveLocalEquipment() {
  localStorage.setItem(storageKey, JSON.stringify(equipment));
}

function loadLocalHistory() {
  const savedHistory = localStorage.getItem(historyStorageKey);

  if (!savedHistory) {
    return [];
  }

  try {
    return JSON.parse(savedHistory);
  } catch (error) {
    return [];
  }
}

function saveLocalHistory() {
  localStorage.setItem(historyStorageKey, JSON.stringify(history));
}

function displayValue(value) {
  return value || "None";
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function todayForDatabase() {
  return new Date().toISOString().slice(0, 10);
}

function todayForDisplay() {
  return formatDate(new Date().toISOString());
}

function updateStatusStyle(status) {
  const isCheckedOut = status === "Checked Out";

  fields.status.classList.toggle("is-checked-out", isCheckedOut);
  fields.listStatus.classList.toggle("is-checked-out", isCheckedOut);
}

function renderQrCode(asset, assetUrl) {
  fields.qrCode.innerHTML = "";
  fields.qrLabel.textContent = asset.assetId;
  fields.qrLinkText.textContent = `Open ${asset.assetId} from a scan`;

  if (!window.QRCode) {
    fields.qrCode.textContent = "QR unavailable";
    return;
  }

  new window.QRCode(fields.qrCode, {
    text: assetUrl.toString(),
    width: 104,
    height: 104,
  });
}

async function loadEquipment() {
  if (!db) {
    equipment = loadLocalEquipment();
    history = loadLocalHistory();
    return;
  }

  const { data: equipmentRows, error: equipmentError } = await db
    .from("equipment")
    .select("*")
    .order("asset_id");

  if (equipmentError) {
    console.error(equipmentError);
    equipment = loadLocalEquipment();
  } else {
    equipment = equipmentRows.map(toAppAsset);
  }

  const { data: historyRows, error: historyError } = await db
    .from("checkout_history")
    .select("*")
    .order("action_date", { ascending: false });

  if (historyError) {
    console.error(historyError);
    history = [];
  } else {
    history = historyRows.map(toAppHistory);
  }
}

async function saveAsset(asset) {
  if (!db) {
    saveLocalEquipment();
    return;
  }

  const { error } = await db
    .from("equipment")
    .update(toDatabaseAsset(asset))
    .eq("asset_id", asset.assetId);

  if (error) {
    console.error(error);
    alert("Supabase could not save this asset. Check your table permissions.");
  }
}

async function addHistoryEvent(asset, action) {
  const event = {
    assetId: asset.assetId,
    action,
    holder: asset.currentHolder,
    projectJob: asset.projectJob,
    date: todayForDisplay(),
  };

  history.unshift(event);

  if (!db) {
    saveLocalHistory();
    return;
  }

  const { error } = await db.from("checkout_history").insert({
    asset_id: asset.assetId,
    action,
    holder: asset.currentHolder,
    project_job: asset.projectJob,
  });

  if (error) {
    console.error(error);
    alert("Supabase could not save the history record.");
  }
}

function renderHistory(assetId) {
  const assetHistory = history.filter((event) => event.assetId === assetId);

  fields.historyList.innerHTML = "";

  if (assetHistory.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty-history";
    emptyItem.textContent = "No history yet";
    fields.historyList.append(emptyItem);
    return;
  }

  assetHistory.forEach((event) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const detail = document.createElement("span");

    title.textContent = `${event.action} on ${event.date}`;
    detail.textContent = `${displayValue(event.holder)} · ${displayValue(
      event.projectJob
    )}`;

    item.append(title, detail);
    fields.historyList.append(item);
  });
}

function showAsset(asset) {
  selectedAsset = asset;
  const assetUrl = new URL(window.location.href);

  assetUrl.searchParams.set("asset", asset.assetId);

  fields.assetId.textContent = asset.assetId;
  fields.equipmentName.textContent = asset.equipmentName;
  fields.category.textContent = asset.category;
  fields.barcode.textContent = asset.barcode;
  fields.status.textContent = asset.status;
  fields.listStatus.textContent = asset.status;
  fields.location.textContent = asset.location;
  fields.currentHolder.textContent = displayValue(asset.currentHolder);
  fields.projectJob.textContent = displayValue(asset.projectJob);
  fields.checkoutDate.textContent = displayValue(formatDate(asset.checkoutDate));
  fields.returnDate.textContent = displayValue(formatDate(asset.returnDate));
  fields.assetLink.href = assetUrl.toString();
  fields.assetLink.textContent = `Open ${asset.assetId}`;
  fields.condition.textContent = asset.condition;
  fields.notes.textContent = asset.notes;
  fields.holderInput.value = asset.currentHolder;
  fields.projectInput.value = asset.projectJob;
  fields.returnButton.disabled = asset.status !== "Checked Out";

  updateStatusStyle(asset.status);
  renderQrCode(asset, assetUrl);
  renderHistory(asset.assetId);
}

document.querySelectorAll("[data-asset-id]").forEach((button) => {
  button.addEventListener("click", () => {
    const asset = equipment.find(
      (item) => item.assetId === button.dataset.assetId
    );

    if (asset) {
      showAsset(asset);
      window.history.replaceState(null, "", `?asset=${asset.assetId}`);
    }
  });
});

fields.checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  selectedAsset.status = "Checked Out";
  selectedAsset.currentHolder = fields.holderInput.value.trim();
  selectedAsset.projectJob = fields.projectInput.value.trim();
  selectedAsset.checkoutDate = todayForDatabase();
  selectedAsset.returnDate = "";

  await addHistoryEvent(selectedAsset, "Checked out");
  await saveAsset(selectedAsset);
  showAsset(selectedAsset);
});

fields.returnButton.addEventListener("click", async () => {
  await addHistoryEvent(selectedAsset, "Returned");

  selectedAsset.status = "Available";
  selectedAsset.currentHolder = "";
  selectedAsset.projectJob = "";
  selectedAsset.returnDate = todayForDatabase();

  await saveAsset(selectedAsset);
  showAsset(selectedAsset);
});

fields.printQrButton.addEventListener("click", () => {
  window.print();
});

async function startApp() {
  await loadEquipment();
  const requestedAssetId = new URLSearchParams(window.location.search).get(
    "asset"
  );
  const requestedAsset = equipment.find(
    (asset) => asset.assetId === requestedAssetId
  );

  if (requestedAsset) {
    showAsset(requestedAsset);
  } else if (equipment.length > 0) {
    showAsset(equipment[0]);
  }
}

startApp();
