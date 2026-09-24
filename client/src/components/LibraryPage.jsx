// Sidebar "Library" section — thin page shell around the shared
// RecipeLibraryBrowser (also embedded inside DietTemplateView's [+ Add
// Recipe] picker, "From Library" tab — see that component's own top
// comment for why they're deliberately the same component, filters and
// all, rather than two look-alikes). No dietType/allergyText/initial
// filters passed here — this is the unrestricted, patient-agnostic view.
import RecipeLibraryBrowser from './RecipeLibraryBrowser';

function LibraryPage() {
  return (
    <div className="issues-page">
      <div className="issues-header">
        <div>
          <h1>Recipe Library</h1>
          <p className="issues-subtitle">Every recipe across every condition, gear and diet — browse, filter, and add new ones here.</p>
        </div>
      </div>
      <RecipeLibraryBrowser />
    </div>
  );
}

export default LibraryPage;
