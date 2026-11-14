//! The document as html5ever builds it: every node in one list, each naming
//! its parent and its children by their place in it.
//!
//! html5ever does the reading, as a browser does: unclosed tags, a table in a
//! paragraph, stray end tags all come out as the tree a browser would build,
//! which is the tree the web client draws. This is only where it is put.

use std::borrow::Cow;
use std::cell::RefCell;

use html5ever::interface::{ElemName, ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::tendril::{StrTendril, TendrilSink as _};
use html5ever::{Attribute, LocalName, Namespace, ParseOpts, QualName, parse_document};

/// A node's place in the document's list.
pub(super) type Id = usize;

/// What a node is.
#[derive(Debug)]
pub(super) enum Kind {
    /// The document itself, or a template's contents.
    Root,
    /// An element, by its name, with its attributes as written.
    Element {
        name: LocalName,
        /// Only HTML elements are drawn: an `svg` or `math` subtree is
        /// another kind of document.
        html: bool,
        attributes: Vec<(LocalName, StrTendril)>,
    },
    Text(StrTendril),
    /// A comment, or anything else nothing is drawn of.
    Other,
}

/// One node of the document.
#[derive(Debug)]
pub(super) struct Node {
    pub kind: Kind,
    pub parent: Option<Id>,
    pub children: Vec<Id>,
}

/// A whole document, read.
#[derive(Debug)]
pub(super) struct Dom {
    pub nodes: Vec<Node>,
}

impl Dom {
    /// Read `html` as a browser reads a document: a page with no doctype
    /// is read as the old pages were, which is how the web client reads one.
    pub(super) fn parse(html: &str) -> Self {
        let mut options = ParseOpts::default();
        // A browser's `DOMParser`, which the web client's sanitiser reads
        // with, runs no scripts, so what a `noscript` holds is markup.
        options.tree_builder.scripting_enabled = false;
        parse_document(Sink::default(), options).one(html)
    }

    /// The `body` the document has, which every document gets.
    pub(super) fn body(&self) -> Option<Id> {
        let html = self.child_named(0, "html")?;
        self.child_named(html, "body")
    }

    fn child_named(&self, parent: Id, wanted: &str) -> Option<Id> {
        self.nodes[parent].children.iter().copied().find(|child| {
            matches!(&self.nodes[*child].kind, Kind::Element { name, .. } if &**name == wanted)
        })
    }

    /// The value of the attribute `wanted` of element `id`, if it has one.
    pub(super) fn attribute(&self, id: Id, wanted: &str) -> Option<&str> {
        let Kind::Element { attributes, .. } = &self.nodes[id].kind else {
            return None;
        };
        attributes
            .iter()
            .find(|(name, _)| &**name == wanted)
            .map(|(_, value)| &**value)
    }
}

/// The builder html5ever hands each node to.
#[derive(Default)]
struct Sink {
    nodes: RefCell<Vec<Node>>,
}

impl Sink {
    fn add(&self, kind: Kind) -> Id {
        let mut nodes = self.nodes.borrow_mut();
        nodes.push(Node {
            kind,
            parent: None,
            children: Vec::new(),
        });
        nodes.len() - 1
    }

    /// Put `child` under `parent`, before the child at `at` or last. Text
    /// next to text joins it, as it does in a browser's tree.
    fn insert(&self, parent: Id, at: Option<usize>, child: NodeOrText<Id>) {
        let mut nodes = self.nodes.borrow_mut();
        let end = at.unwrap_or(nodes[parent].children.len());
        match child {
            NodeOrText::AppendText(text) => {
                let before = end
                    .checked_sub(1)
                    .map(|place| nodes[parent].children[place]);
                if let Some(Kind::Text(held)) = before.map(|id| &mut nodes[id].kind) {
                    held.push_tendril(&text);
                    return;
                }
                let id = nodes.len();
                nodes.push(Node {
                    kind: Kind::Text(text),
                    parent: Some(parent),
                    children: Vec::new(),
                });
                nodes[parent].children.insert(end, id);
            }
            NodeOrText::AppendNode(id) => {
                nodes[id].parent = Some(parent);
                nodes[parent].children.insert(end, id);
            }
        }
    }

    fn detach(&self, id: Id) {
        let mut nodes = self.nodes.borrow_mut();
        if let Some(parent) = nodes[id].parent.take() {
            nodes[parent].children.retain(|child| *child != id);
        }
    }
}

/// An element's name, held apart from the list so the list can change.
#[derive(Debug)]
struct Name(Namespace, LocalName);

impl ElemName for Name {
    fn ns(&self) -> &Namespace {
        &self.0
    }

    fn local_name(&self) -> &LocalName {
        &self.1
    }
}

impl TreeSink for Sink {
    type Handle = Id;
    type Output = Dom;
    type ElemName<'a> = Name;

    fn finish(self) -> Dom {
        Dom {
            nodes: self.nodes.into_inner(),
        }
    }

    fn parse_error(&self, _: Cow<'static, str>) {}

    fn get_document(&self) -> Id {
        if self.nodes.borrow().is_empty() {
            return self.add(Kind::Root);
        }
        0
    }

    fn elem_name<'a>(&'a self, target: &'a Id) -> Name {
        let nodes = self.nodes.borrow();
        match &nodes[*target].kind {
            Kind::Element { name, html, .. } => Name(
                if *html {
                    html5ever::ns!(html)
                } else {
                    html5ever::ns!()
                },
                name.clone(),
            ),
            _ => Name(html5ever::ns!(), LocalName::from("")),
        }
    }

    fn create_element(&self, name: QualName, attrs: Vec<Attribute>, _: ElementFlags) -> Id {
        let html = name.ns == html5ever::ns!(html);
        let attributes = attrs
            .into_iter()
            .map(|attribute| (attribute.name.local, attribute.value))
            .collect();
        self.add(Kind::Element {
            name: name.local,
            html,
            attributes,
        })
    }

    fn create_comment(&self, _: StrTendril) -> Id {
        self.add(Kind::Other)
    }

    fn create_pi(&self, _: StrTendril, _: StrTendril) -> Id {
        self.add(Kind::Other)
    }

    fn append(&self, parent: &Id, child: NodeOrText<Id>) {
        // The document's first node is made on first asking; make sure.
        let _ = self.get_document();
        self.insert(*parent, None, child);
    }

    fn append_based_on_parent_node(&self, element: &Id, prev: &Id, child: NodeOrText<Id>) {
        if self.nodes.borrow()[*element].parent.is_some() {
            self.append_before_sibling(element, child);
        } else {
            self.append(prev, child);
        }
    }

    fn append_doctype_to_document(&self, _: StrTendril, _: StrTendril, _: StrTendril) {}

    fn get_template_contents(&self, _: &Id) -> Id {
        self.add(Kind::Root)
    }

    fn same_node(&self, x: &Id, y: &Id) -> bool {
        x == y
    }

    fn set_quirks_mode(&self, _: QuirksMode) {}

    fn append_before_sibling(&self, sibling: &Id, child: NodeOrText<Id>) {
        let place = {
            let nodes = self.nodes.borrow();
            nodes[*sibling].parent.and_then(|parent| {
                let at = nodes[parent].children.iter().position(|id| id == sibling)?;
                Some((parent, at))
            })
        };
        if let Some((parent, at)) = place {
            if let NodeOrText::AppendNode(id) = &child {
                self.detach(*id);
            }
            self.insert(parent, Some(at), child);
        }
    }

    fn add_attrs_if_missing(&self, target: &Id, attrs: Vec<Attribute>) {
        let mut nodes = self.nodes.borrow_mut();
        if let Kind::Element { attributes, .. } = &mut nodes[*target].kind {
            for attribute in attrs {
                if !attributes
                    .iter()
                    .any(|(name, _)| *name == attribute.name.local)
                {
                    attributes.push((attribute.name.local, attribute.value));
                }
            }
        }
    }

    fn remove_from_parent(&self, target: &Id) {
        self.detach(*target);
    }

    fn reparent_children(&self, node: &Id, new_parent: &Id) {
        let mut nodes = self.nodes.borrow_mut();
        let moved = std::mem::take(&mut nodes[*node].children);
        for child in &moved {
            nodes[*child].parent = Some(*new_parent);
        }
        nodes[*new_parent].children.extend(moved);
    }
}
