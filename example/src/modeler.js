/* global process */

import TokenSimulationModule from "../..";
import SimulationSupportModule from "../../lib/simulation-support";
import BpmnModeler from "bpmn-js/lib/Modeler";

import AddExporter from "@bpmn-io/add-exporter";

import { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } from "bpmn-js-properties-panel";

import fileDrop from "file-drops";

import fileOpen from "file-open";

import download from "downloadjs";

//import exampleXML from "../resources/example.bpmn";

let activityForms = {};
let formMode = "design";
const url = new URL(window.location.href);

const persistent = url.searchParams.has("p");
const active = url.searchParams.has("e");
const presentationMode = url.searchParams.has("pm");
let fileName = "diagram.bpmn";

const initialDiagram = (() => {
  try {
    return (persistent && localStorage["diagram-xml"]) || null;
  } catch (err) {
    return exampleXML;
  }
})();

function showMessage(cls, message) {
  const messageEl = document.querySelector(".drop-message");

  messageEl.textContent = message;
  messageEl.className = `drop-message ${cls || ""}`;

  messageEl.style.display = "block";
}

function hideMessage() {
  //const messageEl = document.querySelector(".drop-message");
  //messageEl.style.display = "none";
}

// if (persistent) {
//   hideMessage();
// }

const ExampleModule = {
  __init__: [
    [
      "eventBus",
      "bpmnjs",
      "toggleMode",
      function (eventBus, bpmnjs, toggleMode) {
        if (persistent) {
          eventBus.on("commandStack.changed", function () {
            bpmnjs.saveXML().then((result) => {
              localStorage["diagram-xml"] = result.xml;
            });
          });
        }

        if ("history" in window) {
          eventBus.on("tokenSimulation.toggleMode", (event) => {
            document.body.classList.toggle("token-simulation-active", event.active);

            if (event.active) {
              url.searchParams.set("e", "1");
            } else {
              url.searchParams.delete("e");
            }

            history.replaceState({}, document.title, url.toString());
          });
        }

        eventBus.on("diagram.init", 500, () => {
          toggleMode.toggleMode(active);
        });
      },
    ],
  ],
};

const modeler = new BpmnModeler({
  container: "#canvas",
  //additionalModules: [BpmnPropertiesPanelModule, BpmnPropertiesProviderModule, TokenSimulationModule, AddExporter, ExampleModule],
  additionalModules: [BpmnPropertiesPanelModule, BpmnPropertiesProviderModule, TokenSimulationModule, SimulationSupportModule, AddExporter, ExampleModule],
  propertiesPanel: {
    parent: "#properties-panel",
  },
  exporter: {
    name: "bpmn-js-token-simulation",
    version: process.env.TOKEN_SIMULATION_VERSION,
  },
});

// Listen to BPMN element clicks
const eventBus = modeler.get("eventBus");

const simulationSupport = modeler.get("simulationSupport");

// =======================================
// Form Activity Simulation Breakpoints
// =======================================

function prepareFormActivityBreakpoints() {
  const elementRegistry = modeler.get("elementRegistry");

  const formElementIds = Object.keys(activityForms);

  console.log("[FORM ELEMENTS]", formElementIds);

  formElementIds.forEach(function (elementId) {
    const element = elementRegistry.get(elementId);

    if (!element || !element.businessObject) {
      console.warn("[ELEMENT NOT FOUND]", elementId);
      return;
    }

    // Only BPMN Activities
    const isActivity = element.businessObject.$instanceOf("bpmn:Activity");

    if (!isActivity) {
      console.log("[SKIPPED - NOT AN ACTIVITY]", elementId);
      return;
    }

    try {
      // 1. Register listener before enabling breakpoint
      const enterPromise = simulationSupport.elementEnter(elementId);

      // 2. Enable pause on this Activity
      simulationSupport.triggerElement(elementId);

      console.log("[BREAKPOINT READY]", elementId);

      // 3. Detect token arrival
      enterPromise
        .then(function (event) {
          const enteredElement = event.element;

          console.log("[TOKEN ENTERED FORM ACTIVITY]", enteredElement.id);

          // Store paused activity ID
          pausedSimulationElementId = enteredElement.id;

          // Automatically display its form
          showActivityForm(enteredElement, true);
        })
        .catch(function (error) {
          console.error("[ELEMENT ENTER ERROR]", elementId, error);
        });
    } catch (error) {
      console.error("[BREAKPOINT ERROR]", elementId, error);
    }
  });
}
// Listen to simulation mode changes
eventBus.on("tokenSimulation.toggleMode", 400, function (event) {
  console.log("[SIMULATION EVENT]", event);

  // Only when Token Simulation is activated
  if (!event.active) {
    return;
  }

  // Automatically switch Form Mode to View
  if (formMode !== "view") {
    console.log("[AUTO SWITCH] Form Design -> Form View");

    setFormMode("view");
  }

  console.log("[FORM MODE]", formMode);

  // Prepare activities with forms
  console.log("Preparing form activities...");

  prepareFormActivityBreakpoints();
});

console.log("Simulation Support initialized:", !!simulationSupport);

console.log("elementEnter:", typeof simulationSupport.elementEnter);

console.log("elementExit:", typeof simulationSupport.elementExit);

console.log("triggerElement:", typeof simulationSupport.triggerElement);

// =====================================
// Activity / Gateway Form
// =====================================

// Get HTML elements
const modal = document.getElementById("activity-form-modal");
const modalTitle = document.getElementById("activity-form-title");
const modalBody = document.getElementById("activity-form-body");

const closeButton = document.getElementById("activity-form-close");
const continueSimulationButton = document.getElementById("activity-form-continue");
let pausedSimulationElementId = null;

const formModeToggle = document.getElementById("form-mode-toggle");

// Close modal
closeButton.addEventListener("click", function () {
  modal.classList.remove("show");
});

// =======================================
// BPMN Activity / Gateway Form Designer
// =======================================

let selectedFormElement = null;

// Modal elements
const formModal = document.getElementById("activity-form-modal");

const formElementTitle = document.getElementById("activity-form-element");

const formTitleInput = document.getElementById("activity-form-title");

const formBody = document.getElementById("activity-form-body");

const addFieldButton = document.getElementById("activity-form-add-field");

const saveFormButton = document.getElementById("activity-form-save");

// Continue simulation after form confirmation

continueSimulationButton.addEventListener("click", function () {
  if (!pausedSimulationElementId) {
    return;
  }

  const elementId = pausedSimulationElementId;

  try {
    console.log("[RESUMING SIMULATION]", elementId);

    // Release activity breakpoint
    simulationSupport.triggerElement(elementId);

    // Clear current paused activity
    pausedSimulationElementId = null;

    // Close modal
    closeActivityForm();

    console.log("[SIMULATION RESUMED]", elementId);
  } catch (error) {
    console.error("[SIMULATION RESUME ERROR]", error);
  }
});

const closeFormButton = document.getElementById("activity-form-close");

const cancelFormButton = document.getElementById("activity-form-cancel");

// Add a new field row
// Add a new field to the form designer or viewer
function addFormField(field = {}, readOnly = false) {
  const row = document.createElement("div");

  row.className = "activity-form-row";

  const fieldType = field.type || "text";
  const fieldOptions = Array.isArray(field.options) ? field.options : [];

  // =========================
  // VIEW MODE
  // =========================

  if (readOnly) {
    row.classList.add("view-row");

    // Field label
    const label = document.createElement("label");

    label.textContent = field.label || "";

    row.appendChild(label);

    // Text field
    if (fieldType === "text") {
      const input = document.createElement("input");

      input.type = "text";
      input.className = "field-value";
      input.value = field.value || "";
      input.readOnly = true;

      row.appendChild(input);
    }

    // Dropdown field
    else if (fieldType === "dropdown") {
      const select = document.createElement("select");

      select.className = "field-value";

      // Placeholder
      const placeholder = document.createElement("option");

      placeholder.value = "";
      placeholder.textContent = "Select an option";

      select.appendChild(placeholder);

      // Add dropdown options
      fieldOptions.forEach(function (value) {
        const option = document.createElement("option");

        option.value = value;
        option.textContent = value;

        select.appendChild(option);
      });

      // Set default value
      select.value = field.value || "";

      row.appendChild(select);
    }

    formBody.appendChild(row);

    return;
  }

  // =========================
  // DESIGN MODE
  // =========================

  // Field label
  const labelContainer = document.createElement("div");

  labelContainer.className = "field-control";

  const labelText = document.createElement("label");

  labelText.textContent = "Field Label";

  const labelInput = document.createElement("input");

  labelInput.type = "text";
  labelInput.className = "field-label";
  labelInput.placeholder = "Enter field name";
  labelInput.value = field.label || "";

  labelContainer.appendChild(labelText);
  labelContainer.appendChild(labelInput);

  // Field type
  const typeContainer = document.createElement("div");

  typeContainer.className = "field-control";

  const typeLabel = document.createElement("label");

  typeLabel.textContent = "Field Type";

  const typeSelect = document.createElement("select");

  typeSelect.className = "field-type";

  const textOption = document.createElement("option");

  textOption.value = "text";
  textOption.textContent = "Text";

  const dropdownOption = document.createElement("option");

  dropdownOption.value = "dropdown";
  dropdownOption.textContent = "Dropdown";

  typeSelect.appendChild(textOption);
  typeSelect.appendChild(dropdownOption);

  typeSelect.value = fieldType;

  typeContainer.appendChild(typeLabel);
  typeContainer.appendChild(typeSelect);

  // Field configuration
  const configContainer = document.createElement("div");

  configContainer.className = "field-control field-config";

  // Default value
  const valueLabel = document.createElement("label");

  valueLabel.textContent = "Default Value";

  const valueInput = document.createElement("input");

  valueInput.type = "text";
  valueInput.className = "field-value";
  valueInput.placeholder = "Enter default value";
  valueInput.value = field.value || "";

  configContainer.appendChild(valueLabel);
  configContainer.appendChild(valueInput);

  // Dropdown options
  const optionsContainer = document.createElement("div");

  optionsContainer.className = "field-options-control";

  const optionsLabel = document.createElement("label");

  optionsLabel.textContent = "Dropdown Options";

  const optionsInput = document.createElement("input");

  optionsInput.type = "text";
  optionsInput.className = "field-options";
  optionsInput.placeholder = "Iran, Germany, Turkey";

  optionsInput.value = fieldOptions.join(", ");

  optionsContainer.appendChild(optionsLabel);
  optionsContainer.appendChild(optionsInput);

  configContainer.appendChild(optionsContainer);

  // Show options only for dropdown
  optionsContainer.hidden = fieldType !== "dropdown";

  typeSelect.addEventListener("change", function () {
    optionsContainer.hidden = typeSelect.value !== "dropdown";
  });

  // Remove button
  const removeButton = document.createElement("button");

  removeButton.type = "button";
  removeButton.className = "remove-field-button";
  removeButton.textContent = "Remove";

  removeButton.addEventListener("click", function () {
    row.remove();
  });

  row.appendChild(labelContainer);
  row.appendChild(typeContainer);
  row.appendChild(configContainer);
  row.appendChild(removeButton);

  formBody.appendChild(row);
}
// Open form designer for selected BPMN element
function showActivityForm(element, fromSimulation = false) {
  selectedFormElement = element;

  const elementId = element.id;

  const businessObject = element.businessObject;

  const existingForm = activityForms[elementId];

  const isDesignMode = formMode === "design";

  // Set element title
  // Form title
  const titleContainer = document.querySelector(".form-title-container");

  if (isDesignMode) {
    // Design mode: show BPMN element name and ID
    formElementTitle.textContent = `${businessObject.name || elementId} (${elementId})`;

    formTitleInput.value = existingForm ? existingForm.title : businessObject.name || "";

    titleContainer.hidden = false;
  } else {
    // View mode: show Persian form title, not element ID
    formElementTitle.textContent = existingForm && existingForm.title ? existingForm.title : "فرمی برای این عنصر تعریف نشده است";

    titleContainer.hidden = true;
  }

  formTitleInput.readOnly = !isDesignMode;

  // Set form title
  //  formTitleInput.value = existingForm ? existingForm.title : isDesignMode ? businessObject.name || elementId : "";

  formTitleInput.readOnly = !isDesignMode;

  // Show or hide designer buttons
  addFieldButton.hidden = !isDesignMode;

  saveFormButton.hidden = !isDesignMode;

  cancelFormButton.hidden = !isDesignMode;

  // Show Continue button only during simulation
  continueSimulationButton.hidden = !fromSimulation;

  // Prevent closing simulation form without continuing
  closeFormButton.hidden = fromSimulation;
  // Clear previous fields
  formBody.replaceChildren();

  // View mode: only display existing form
  if (!isDesignMode && !existingForm) {
    const message = document.createElement("p");

    message.textContent = "No form defined for this element.";

    formBody.appendChild(message);

    formModal.classList.add("show");

    return;
  }

  // Load existing fields
  if (existingForm && existingForm.fields) {
    existingForm.fields.forEach(function (field) {
      addFormField(field, !isDesignMode);
    });
  }

  // Open modal
  formModal.classList.add("show");
}
function setFormMode(mode) {
  formMode = mode;

  const isView = mode === "view";

  // Toggle active state
  formModeToggle.classList.toggle("active", isView);

  // Update accessibility state
  formModeToggle.setAttribute("aria-pressed", String(isView));

  // Update label
  formModeToggle.querySelector(".form-mode-label").textContent = isView ? "Form View" : "Form Design";

  // Update toggle icon
  formModeToggle.querySelector(".form-mode-icon").innerHTML = isView
    ? `
      <svg viewBox="0 0 28 16">
        <rect x="1" y="1" width="26" height="14" rx="7"
          fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="20" cy="8" r="5" fill="currentColor"/>
      </svg>
    `
    : `
      <svg viewBox="0 0 28 16">
        <rect x="1" y="1" width="26" height="14" rx="7"
          fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="8" cy="8" r="5" fill="currentColor"/>
      </svg>
    `;

  // Close current form
  closeActivityForm();

  console.log("Form mode:", formMode);
}

// Toggle between Design and View
formModeToggle.addEventListener("click", function () {
  setFormMode(formMode === "design" ? "view" : "design");
});

// // Initialize default state
// setFormMode("design");
// designModeButton.addEventListener("click", function () {
//   setFormMode("design");
// });

// viewModeButton.addEventListener("click", function () {
//   setFormMode("view");
// });
// Add field button
addFieldButton.addEventListener("click", function () {
  if (formMode !== "design") {
    return;
  }

  addFormField();
});

// Save form in memory
saveFormButton.addEventListener("click", function () {
  if (formMode !== "design") {
    return;
  }

  if (!selectedFormElement) {
    return;
  }

  const elementId = selectedFormElement.id;

  const fields = Array.from(formBody.querySelectorAll(".activity-form-row"))
    .map(function (row) {
      const type = row.querySelector(".field-type").value;

      const field = {
        label: row.querySelector(".field-label").value.trim(),
        type: type,
        value: row.querySelector(".field-value").value,
      };

      // Add options only for dropdown
      if (type === "dropdown") {
        field.options = row
          .querySelector(".field-options")
          .value.split(",")
          .map((option) => option.trim())
          .filter((option) => option !== "");
      }

      return field;
    })
    .filter(function (field) {
      return field.label !== "";
    });

  // Save form
  activityForms[elementId] = {
    title: formTitleInput.value.trim() || elementId,

    fields: fields,
  };

  console.log("Form saved:", elementId);

  console.log(activityForms);

  formModal.classList.remove("show");
});
// Close modal
function closeActivityForm() {
  formModal.classList.remove("show");
}

closeFormButton.addEventListener("click", closeActivityForm);

cancelFormButton.addEventListener("click", closeActivityForm);

// Download all forms as JSON
document.getElementById("download-forms-button").addEventListener("click", function () {
  if (Object.keys(activityForms).length === 0) {
    alert("No forms have been created yet.");

    return;
  }

  const json = JSON.stringify(activityForms, null, 2);

  const jsonFileName = fileName.replace(/\.(bpmn|bpmn2|xml)$/i, "") + ".json";

  download(json, jsonFileName, "application/json");
});

eventBus.on("element.click", function (event) {
  const element = event.element;

  if (!element.businessObject) {
    return;
  }

  const businessObject = element.businessObject;

  const isActivity = businessObject.$instanceOf("bpmn:Activity");

  const isGateway = businessObject.$instanceOf("bpmn:Gateway");

  if (isActivity || isGateway) {
    showActivityForm(element);
  }
});

console.log("BPMN Form Designer initialized");
console.log("Activity form listener initialized");

// Create a new BPMN diagram
function createNewDiagram() {
  // Prevent accidental loss of current diagram
  const confirmed = window.confirm("Create a new diagram? Current changes will be lost.");

  if (!confirmed) {
    return;
  }

  // Reset file name
  fileName = "diagram.bpmn";

  // Clear old forms
  activityForms = {};

  // Hide welcome message
  hideMessage();

  // Create new diagram
  modeler
    .createDiagram()
    .then(({ warnings }) => {
      if (warnings.length) {
        console.warn(warnings);
      }

      // Fit diagram into viewport
      modeler.get("canvas").zoom("fit-viewport");

      console.log("New BPMN diagram created");
    })
    .catch((error) => {
      console.error("Failed to create diagram:", error);

      showMessage("error", "Failed to create new diagram.");
    });
}

function openDiagram(diagram) {
  return modeler
    .importXML(diagram)
    .then(({ warnings }) => {
      if (warnings.length) {
        console.warn(warnings);
      }

      if (persistent) {
        localStorage["diagram-xml"] = diagram;
      }

      modeler.get("canvas").zoom("fit-viewport");
    })
    .catch((err) => {
      console.error(err);
    });
}

if (presentationMode) {
  document.body.classList.add("presentation-mode");
}

function openFile(files) {
  // files = [ { name, contents }, ... ]

  if (!files.length) {
    return;
  }

  hideMessage();

  fileName = files[0].name;

  openDiagram(files[0].contents);
}
function openFiles(files) {
  if (!files || !files.length) {
    return;
  }

  // Find BPMN and JSON files
  const bpmnFiles = files.filter((file) => /\.(bpmn|bpmn2|xml)$/i.test(file.name));

  const jsonFiles = files.filter((file) => /\.json$/i.test(file.name));

  // Check selected files
  if (bpmnFiles.length !== 1 || jsonFiles.length > 1) {
    showMessage("error", "Please select one BPMN file and one JSON file.");

    return;
  }

  const bpmnFile = bpmnFiles[0];

  if (jsonFiles.length === 1) {
    const jsonFile = jsonFiles[0];

    // Read JSON
    try {
      activityForms = JSON.parse(jsonFile.contents);
    } catch (error) {
      showMessage("error", "Invalid JSON forms file.");

      console.error(error);

      return;
    }
  } else {
    activityForms = [];
  }
  // Open BPMN diagram
  hideMessage();

  fileName = bpmnFile.name;

  openDiagram(bpmnFile.contents);

  console.log("BPMN loaded:", bpmnFile.name);
  //console.log("Forms loaded:", jsonFile.name);
}

function openJsonFiles(files) {
  if (!files || !files.length) {
    return;
  }

  const jsonFiles = files.filter((file) => /\.json$/i.test(file.name));
  // Check selected files
  if (jsonFiles.length !== 1) {
    showMessage("error", "Please select one JSON file.");
    return;
  }

  const jsonFile = jsonFiles[0];

  // Read JSON
  try {
    activityForms = JSON.parse(jsonFile.contents);
  } catch (error) {
    showMessage("error", "Invalid JSON forms file.");

    console.error(error);

    return;
  }

  // Open BPMN diagram
  hideMessage();
}

document.body.addEventListener("dragover", fileDrop("Open BPMN diagram", openFile), false);

function downloadDiagram() {
  modeler.saveXML({ format: true }).then(({ xml }) => {
    download(xml, fileName, "application/xml");
  });
}

document.body.addEventListener("keydown", function (event) {
  if (event.code === "KeyS" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();

    downloadDiagram();
  }

  if (event.code === "KeyO" && (event.metaKey || event.ctrlKey)) {
    // event.preventDefault();
    // fileOpen().then(openFile);

    event.preventDefault();

    fileOpen({
      multiple: true,
      accept: ".bpmn,.bpmn2,.xml,.json",
    }).then(openFiles);
  } else if (event.code === "KeyJ" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    fileOpen({
      accept: ".json",
    }).then(openJsonFiles);
  }
});

document.querySelector("#download-button").addEventListener("click", function (event) {
  downloadDiagram();
});

document.querySelector("#new-diagram-button").addEventListener("click", createNewDiagram);
document.querySelector("#open-diagram-button").addEventListener("click", () => {
  fileOpen({
    multiple: true,
    accept: ".bpmn,.bpmn2,.xml,.json",
  }).then(openFiles);
});

const propertiesPanel = document.querySelector("#properties-panel");

const propertiesPanelResizer = document.querySelector("#properties-panel-resizer");

let startX, startWidth;

function toggleProperties(open) {
  if (open) {
    url.searchParams.set("pp", "1");
  } else {
    url.searchParams.delete("pp");
  }

  history.replaceState({}, document.title, url.toString());

  propertiesPanel.classList.toggle("open", open);
}

propertiesPanelResizer.addEventListener("click", function (event) {
  toggleProperties(!propertiesPanel.classList.contains("open"));
});

propertiesPanelResizer.addEventListener("dragstart", function (event) {
  const img = new Image();
  img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  event.dataTransfer.setDragImage(img, 1, 1);

  startX = event.screenX;
  startWidth = propertiesPanel.getBoundingClientRect().width;
});

propertiesPanelResizer.addEventListener("drag", function (event) {
  if (!event.screenX) {
    return;
  }

  const delta = event.screenX - startX;

  const width = startWidth - delta;

  const open = width > 200;

  propertiesPanel.style.width = open ? `${width}px` : null;

  toggleProperties(open);
});

const remoteDiagram = url.searchParams.get("diagram");

if (remoteDiagram) {
  fetch(remoteDiagram)
    .then((r) => {
      if (r.ok) {
        return r.text();
      }

      throw new Error(`Status ${r.status}`);
    })
    .then((text) => openDiagram(text))
    .catch((err) => {
      showMessage("error", `Failed to open remote diagram: ${err.message}`);
    });
} else if (initialDiagram) {
  openDiagram(initialDiagram);
}

toggleProperties(url.searchParams.has("pp"));
