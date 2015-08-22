use value::{Value};

// Primitive views are how Eve programs access built-in functions
#[derive(Clone, Debug, Copy)]
pub struct Python {
    func_name: u8,
}

impl Python {
    pub fn new(name: u8) -> Python {
        Python {
            func_name: name,
        }
    }

    pub fn eval<'a>(&self, input_bindings: &[(usize, usize)], inputs: &[Value], source: &str, errors: &mut Vec<Vec<Value>>) -> Vec<Vec<Value>> {
        //use python::Python::*;
        use value::Value::*;
        let values = input_bindings.iter().enumerate().map(|(ix, &(field_ix, variable_ix))| {
            assert_eq!(ix, field_ix);
            &inputs[variable_ix]
        }).collect::<Vec<_>>();
        let mut type_error = || {
            errors.push(vec![
                String(source.to_owned()),
                string!("Type error while calling: {:?} {:?}", self, &values)
                ]);
            vec![]
        };
        match (self.func_name, &values[..]) {
            // NOTE be aware that arguments will be in alphabetical order by field id
            (0, [ref a]) => {
                match a.parse_as_f64_vec() {
                    Some(a) => {
                        if a.len() == 0 {
                            vec![vec![Float(0f64)]]
                        } else {
                            let sum = a.iter().fold(0f64, |acc, value| { acc + value });
                            vec![vec![Float(sum)]]
                        }
                    }
                    None => type_error(),
                }
            }
            _ => type_error(),
        }
    }

    pub fn from_str(string: &str) -> Self {
        match string {
            "pysum" => Python::new(0),
            _ => panic!("Unknown python function: {:?}", string),
        }
    }
}

// List of (view_id, scalar_input_field_ids, vector_input_field_ids, output_field_ids, description)
pub fn python_funcs() -> Vec<(&'static str, Vec<&'static str>, Vec<&'static str>, Vec<&'static str>, &'static str)> {
    vec![
        ("pysum", vec![], vec!["A"], vec!["result"], "Python Sum together the elements of A."),
    ]
}
