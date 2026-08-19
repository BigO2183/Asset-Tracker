const storageKey = "equipment-asset-tracker-assets";

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

let equipment = loadEquipment();

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
  condition: document.querySelector("#asset-condition"),
  notes: document.querySelector("#asset-notes"),
  holderInput: document.querySelector("#holder-input"),
  projectInput: document.querySelector("#project-input"),
  checkoutForm: document.querySelector("#checkout-form"),
  returnButton: document.querySelector("#return-button"),
};

let selectedAsset = equipment[0];

function loadEquipment() {
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

function saveEquipment() {
  localStorage.setItem(storageKey, JSON.stringify(equipment));
}

function displayValue(value) {
  return value || "None";
}

function today() {
  return new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function updateStatusStyle(status) {
  const isCheckedOut = status === "Checked Out";

  fields.status.classList.toggle("is-checked-out", isCheckedOut);
  fields.listStatus.classList.toggle("is-checked-out", isCheckedOut);
}

function showAsset(asset) {
  selectedAsset = asset;

  fields.assetId.textContent = asset.assetId;
  fields.equipmentName.textContent = asset.equipmentName;
  fields.category.textContent = asset.category;
  fields.barcode.textContent = asset.barcode;
  fields.status.textContent = asset.status;
  fields.listStatus.textContent = asset.status;
  fields.location.textContent = asset.location;
  fields.currentHolder.textContent = displayValue(asset.currentHolder);
  fields.projectJob.textContent = displayValue(asset.projectJob);
  fields.checkoutDate.textContent = displayValue(asset.checkoutDate);
  fields.returnDate.textContent = displayValue(asset.returnDate);
  fields.condition.textContent = asset.condition;
  fields.notes.textContent = asset.notes;
  fields.holderInput.value = asset.currentHolder;
  fields.projectInput.value = asset.projectJob;
  fields.returnButton.disabled = asset.status !== "Checked Out";

  updateStatusStyle(asset.status);
}

document.querySelectorAll("[data-asset-id]").forEach((button) => {
  button.addEventListener("click", () => {
    const asset = equipment.find(
      (asset) => asset.assetId === button.dataset.assetId
    );

    if (asset) {
      showAsset(asset);
    }
  });
});

fields.checkoutForm.addEventListener("submit", (event) => {
  event.preventDefault();

  selectedAsset.status = "Checked Out";
  selectedAsset.currentHolder = fields.holderInput.value.trim();
  selectedAsset.projectJob = fields.projectInput.value.trim();
  selectedAsset.checkoutDate = today();
  selectedAsset.returnDate = "";

  saveEquipment();
  showAsset(selectedAsset);
});

fields.returnButton.addEventListener("click", () => {
  selectedAsset.status = "Available";
  selectedAsset.currentHolder = "";
  selectedAsset.projectJob = "";
  selectedAsset.returnDate = today();

  saveEquipment();
  showAsset(selectedAsset);
});

showAsset(equipment[0]);
