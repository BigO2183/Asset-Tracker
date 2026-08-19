const equipment = [
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
  location: document.querySelector("#asset-location"),
  currentHolder: document.querySelector("#asset-holder"),
  projectJob: document.querySelector("#asset-project"),
  condition: document.querySelector("#asset-condition"),
  notes: document.querySelector("#asset-notes"),
};

function displayValue(value) {
  return value || "None";
}

function showAsset(asset) {
  fields.assetId.textContent = asset.assetId;
  fields.equipmentName.textContent = asset.equipmentName;
  fields.category.textContent = asset.category;
  fields.barcode.textContent = asset.barcode;
  fields.status.textContent = asset.status;
  fields.location.textContent = asset.location;
  fields.currentHolder.textContent = displayValue(asset.currentHolder);
  fields.projectJob.textContent = displayValue(asset.projectJob);
  fields.condition.textContent = asset.condition;
  fields.notes.textContent = asset.notes;
}

document.querySelectorAll("[data-asset-id]").forEach((button) => {
  button.addEventListener("click", () => {
    const selectedAsset = equipment.find(
      (asset) => asset.assetId === button.dataset.assetId
    );

    if (selectedAsset) {
      showAsset(selectedAsset);
    }
  });
});

showAsset(equipment[0]);
