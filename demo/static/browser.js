const leftPanel = document.getElementById('left-panel');
const FilterIcon = document.getElementById('filter-icon');

function openImage(card) {
    const imgSrc = card.querySelector('img').src;

  // Set image in overlay
    document.getElementById('overlay-img').src = imgSrc;

    // Set metadata
    document.getElementById('meta-title').textContent = card.dataset.title || '';
    document.getElementById('meta-description').textContent = card.dataset.description || '';
    document.getElementById('meta-doi').textContent = card.dataset.doi || '—';
    document.getElementById('meta-keywords').textContent = card.dataset.keywords || '';
    document.getElementById('meta-chart-type').textContent = card.dataset.chartType || '';

    document.getElementById("chart-folder").value = card.dataset.folder;

    // Set form value for "Try it now" button with filename param
    document.getElementById('try-filename').value = card.dataset.filename;

    // Show the overlay
    document.getElementById('overlay').style.display = 'flex';
}

function closeOverlay() {
    document.getElementById('overlay').style.display = 'none';
}

// Open the upload popup
function openUploadOverlay() {
    document.getElementById('upload-overlay').style.display = 'flex';
}

// CLOSE upload overlay
function closeUploadOverlay() {
    document.getElementById('upload-overlay').style.display = 'none';
}



FilterIcon.addEventListener('click', () => {
    leftPanel.classList.toggle('collapsed');
});


// filter operations
document.addEventListener("DOMContentLoaded", function () {
  const searchInput = document.getElementById("keyword-filter");
  const orderSelect = document.getElementById("order-select");
  const chartCountLabel = document.getElementById("chart-count-label");
  const gallery = document.querySelector(".gallery");
  const galleryItems = Array.from(gallery.children); // .gallery-item divs

  function normalize(str) {
    return (str || "").toString().trim().toLowerCase();
  }

  function filterAndSort() {
    const keyword = normalize(searchInput.value);
    const orderBy = orderSelect.value;

    const visibleItems = galleryItems.filter(item => {
      const card = item.querySelector(".image-card");
      const keywords = normalize(card.dataset.keywords);
      return keyword === "" || keywords.includes(keyword);
    });

    // Sort the visible items
    visibleItems.sort((a, b) => {
      const aCard = a.querySelector(".image-card");
      const bCard = b.querySelector(".image-card");

      const aVal = normalize(aCard.dataset[orderBy]);
      const bVal = normalize(bCard.dataset[orderBy]);

      return aVal.localeCompare(bVal);
    });

    // Hide all items, then re-show visible ones
    galleryItems.forEach(item => item.style.display = "none");
    visibleItems.forEach(item => {
      item.style.display = "flex";
      gallery.appendChild(item);  // Reorder DOM
    });

    // Update count
    chartCountLabel.textContent = `Total charts: ${visibleItems.length}`;
  }

  searchInput.addEventListener("input", filterAndSort);
  orderSelect.addEventListener("change", filterAndSort);

  filterAndSort(); // Initial call
});

