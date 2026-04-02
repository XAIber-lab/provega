document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("searchInput");
  const matchStatus = document.getElementById("matchStatus");
  const hamburgerIcon = document.getElementById('hamburger-icon');

  const search = ace.require("ace/search").Search;
  const searchInstance = new search();

  const expandButton = document.querySelector(".expand-button");
  let expanded = false;
  const left = document.querySelector(".middle-panel");
  const right = document.querySelector(".right-panel");

  let currentMatchIndex = 0;
  let matchRanges = [];

  window.performSearch = () => {
    const query = searchInput.value.trim();
    matchRanges = [];
    currentMatchIndex = 0;
    matchStatus.textContent = "";

    if (!query) {
      editor.session.clearSelection();
      editor.focus();
      return;
    }

    searchInstance.set({
      needle: query,
      wrap: true,
      caseSensitive: false,
      wholeWord: false,
      regExp: false
    });

    // All matches
    matchRanges = searchInstance.findAll(editor.session);
    if (matchRanges.length > 0) {
      editor.selection.setSelectionRange(matchRanges[0]);
      editor.scrollToLine(matchRanges[0].start.row, true, true, () => {});
      matchStatus.textContent = `1 of ${matchRanges.length}`;
    } else {
      matchStatus.textContent = "0 results";
    }
    editor.moveCursorToPosition(matchRanges[0].start);
    editor.focus();
  };

  window.nextMatch = () => {
    if (matchRanges.length === 0) return;

    currentMatchIndex = (currentMatchIndex + 1) % matchRanges.length;
    const range = matchRanges[currentMatchIndex];
    editor.selection.setSelectionRange(range);
    editor.scrollToLine(range.start.row, true, true, () => {});
    matchStatus.textContent = `${currentMatchIndex + 1} of ${matchRanges.length}`;

    editor.moveCursorToPosition(range.start);
    editor.focus();
  };

  window.prevMatch = () => {
    if (matchRanges.length === 0) return;

    currentMatchIndex = (currentMatchIndex - 1 + matchRanges.length) % matchRanges.length;
    const range = matchRanges[currentMatchIndex];
    editor.selection.setSelectionRange(range);
    editor.scrollToLine(range.start.row, true, true, () => {});
    matchStatus.textContent = `${currentMatchIndex + 1} of ${matchRanges.length}`;

    editor.moveCursorToPosition(range.start);
    editor.focus();
  };

  window.zoomIn = () => {
    const currentSize = parseInt(editor.getFontSize(), 10);
    editor.setFontSize(Math.min(currentSize + 1, 28));
    editor.resize(true);
  }

  window.zoomOut = () => {
    const currentSize = parseInt(editor.getFontSize(), 10);
    editor.setFontSize(Math.max(currentSize - 1, 8));
    editor.resize(true);
  }

  // Resize of the left menu
  const leftPanel = document.getElementById('left-panel');
  const resizer = leftPanel.querySelector('.resizer');
  if(resizer){
    const advancedViewToggle = document.getElementById('advanced-view-toggle');

    let isResizing = false;

    const DEFAULT_WIDTH = '280px';

    function canResize() {
      const isAdvancedView = advancedViewToggle.checked;
      const isNotCollapsed = !leftPanel.classList.contains('collapsed');
      return isAdvancedView && isNotCollapsed;
    }

    // Cursor
    function updateResizableState() {
      if (canResize()) {
        leftPanel.classList.add('resizable-enabled');
      } else {
        leftPanel.classList.remove('resizable-enabled');
        leftPanel.classList.remove('resizing');
        document.body.classList.remove('noselect');

        // Fixed width
        leftPanel.style.width = DEFAULT_WIDTH;
    }
  }

      resizer.addEventListener('mousedown', (e) => {
      if (!canResize()) return;

      isResizing = true;
      leftPanel.classList.add('resizing');
      document.body.classList.add('noselect');

      const startX = e.clientX;
      const startWidth = leftPanel.offsetWidth;

      function onMouseMove(e) {
        if (!isResizing) return;

        const dx = e.clientX - startX;
        let newWidth = startWidth + dx;
        const maxWidth = window.innerWidth / 2;

        newWidth = Math.min(Math.max(newWidth, 100), maxWidth);

        leftPanel.style.width = `${newWidth}px`;
      }

      function onMouseUp() {
        isResizing = false;
        leftPanel.classList.remove('resizing');
        document.body.classList.remove('noselect');

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // When "advanced" mode changes
    advancedViewToggle.addEventListener('change', () => {
      updateResizableState();
    });

    // Initialize state on startup
    updateResizableState();

    hamburgerIcon.addEventListener('click', () => {
          leftPanel.classList.toggle('collapsed');
          updateResizableState();
      });


    // Expand aux function
    expandButton.addEventListener("click", () => {
      if(!expanded){
        left.style.flex = '1';
        right.style.flex = '0';
        right.style.opacity = '0';
        right.style.pointerEvents = 'none';
      }

      else {
        left.style.flex = '1';
        right.style.flex = '1';
        right.style.opacity = '1';
        right.style.pointerEvents = 'auto';
      }

      expanded = !expanded;

    });
  }
});
